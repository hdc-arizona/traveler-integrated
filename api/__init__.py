import os
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

args = parser.parse_args()

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
        if not sourceFile['stillLoading']:
            allFilesReady = False
            filesMustBeReady.discard(sourceFile['fileType'])
    if len(requiredFiles) > 0:
        raise HTTPException(status_code=404, detail='Dataset does not contain required data: %s' % ', '.join(requiredFiles))
    if allFilesMustBeReady and not allFilesReady:
        raise HTTPException(status_code=503, detail='Dataset is not finished loading')
    if len(filesMustBeReady) > 0:
        raise HTTPException(status_code=503, detail='Required data still loading: %s' % ', '.join(filesMustBeReady))

    return datasetId

class ClientLogger:
    def __init__(self):
        self.message = ''
        self.finished = False

    async def log(self, value, end='\n'):
        self.message += value + end
        await asyncio.sleep(0)

    def finish(self):
        self.finished = True

    async def iterate(self, startProcess):
        await startProcess()
        while not self.finished:
            yield self.message
            self.message = ''
            await asyncio.sleep(0)
        yield self.message
        self.message = ''
