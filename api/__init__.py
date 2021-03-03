import os
import sys
import math
import json
import asyncio
import argparse
from fastapi import HTTPException
from data_store import DataStore


parser = argparse.ArgumentParser(description='Serve the traveler-integrated interface')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help=('Directory where the bundled data is already / will be stored '
                          '(default: /tmp/traveler-integrated)'))
parser.add_argument('-s', '--debug', dest='debug', action='store_true',
                    help='Store additional information for debugging source files, etc.')
parser.add_argument('-p', '--port', dest='port', default=os.environ.get('TRAVELER_PORT', '8000'),
                    help='Port to serve the interface from. Will override TRAVELER_PORT if specified.')
parser.add_argument('-l', '--log_level', dest='log_level', default='warning',
                    help='log_level corresponding to Uvicorn settings (https://www.uvicorn.org/settings/); levels above info will also display traveler parsing logs')

args = parser.parse_args()

traveler_parse_levels = ['info', 'debug', 'trace']

db = DataStore(args.dbDir, args.debug)

def validateDataset(datasetId, requiredFiles=None, filesMustBeReady=None, allFilesMustBeReady=False):
    if datasetId not in db:
        # Not strictly RESTful, but we also support looking up datasets by their label
        print('validating', datasetId)
        for dataset in db:
            if dataset['info']['label'] == datasetId:
                datasetId = dataset['info']['datasetId']
                break
        if datasetId not in db:
            raise HTTPException(status_code=404, detail='Dataset not found')

    requiredFiles = set(requiredFiles or [])
    filesMustBeReady = set(filesMustBeReady or [])
    allFilesReady = True
    for sourceFile in db[datasetId]['info']['sourceFiles']:
        requiredFiles.discard(sourceFile['fileType'])
        if sourceFile['stillLoading']:
            allFilesReady = False
        else:
            filesMustBeReady.discard(sourceFile['fileType'])
    if len(requiredFiles) > 0:
        message = '404: Dataset does not contain required data: %s' % ', '.join(requiredFiles)
        print(message) # fastAPI's default spew doesn't include the detail
        raise HTTPException(status_code=404, detail=message)
    if allFilesMustBeReady and not allFilesReady:
        message = '503: Dataset is not finished loading; this request requires all data to have finished loading'
        print(message) # fastAPI's default spew doesn't include the detail
        raise HTTPException(status_code=503, detail=message)
    if len(filesMustBeReady) > 0:
        message = '503: Required data still loading: %s' % ', '.join(filesMustBeReady)
        print(message) # fastAPI's default spew doesn't include the detail
        raise HTTPException(status_code=503, detail=message)

    return datasetId

def getSanitizedDatasetInfo(datasetId):
    # A bug in fastAPI / pydantic causes errors when returning infinite or nan
    # floats: https://github.com/tiangolo/fastapi/issues/1310

    def sanitize(value):
        if type(value) == float and (math.isinf(value) or math.isnan(value)):
            return str(value)
        else:
            return value;

    def recurseList(original, sanitizedCopy):
        for value in original:
            if isinstance(value, list):
                sanitizedCopy.append(recurseList(value, []))
            elif isinstance(value, dict):
                sanitizedCopy.append(recurseDict(value, {}))
            else:
                sanitizedCopy.append(sanitize(value))
        return sanitizedCopy

    def recurseDict(original, sanitizedCopy):
        for key, value in original.items():
            if isinstance(value, list):
                sanitizedCopy[key] = recurseList(value, [])
            elif isinstance(value, dict):
                sanitizedCopy[key] = recurseDict(value, {})
            else:
                sanitizedCopy[key] = sanitize(value)
        return sanitizedCopy

    return recurseDict(db[datasetId]['info'], {})

class ClientLogger:
    def __init__(self):
        self.extraArgs = {}
        self.message = '{"log":"'
        self.finished = False

    def addMetadata(self, key, value):
        self.extraArgs[key] = value

    async def log(self, value, end='\n'):
        # json.dumps().strip() = sneaky way to escape characters for json while
        # still appending to the string
        self.message += json.dumps(value + end).strip('"')
        if args.log_level in traveler_parse_levels:
            sys.stdout.write('\x1b[0;32;40m' + value + end + '\x1b[0m')
            sys.stdout.flush()
        await asyncio.sleep(0)

    def finish(self):
        self.message += '"'
        for key, value in self.extraArgs.items():
            self.message += ',"%s":%s' % (key, json.dumps(value))
        self.message += '}'
        self.finished = True

    async def iterate(self, startProcess):
        await startProcess()
        while not self.finished:
            yield self.message
            self.message = ''
            await asyncio.sleep(0)
        yield self.message
        self.message = ''
