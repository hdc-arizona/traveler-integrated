#!/usr/bin/env python3
import argparse
import json
from enum import Enum
import uvicorn #pylint: disable=import-error
from fastapi import FastAPI, File, UploadFile, HTTPException #pylint: disable=import-error
from starlette.staticfiles import StaticFiles #pylint: disable=import-error
from starlette.responses import RedirectResponse, StreamingResponse #pylint: disable=import-error
from database import Database

parser = argparse.ArgumentParser(description='Serve the traveler-integrated interface')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help='Directory where the bundled data is already / will be stored (default: /tmp/traveler-integrated)')
parser.add_argument('-s', '--debug', dest='debug', action='store_true',
                    help='Store additional information for debugging source files, etc.')

args = parser.parse_args()
db = Database(args.dbDir, args.debug)
def checkLabel(label):
    if label not in db:
        raise HTTPException(status_code=404, detail='Dataset not found')

app = FastAPI(
    title=__name__,
    description='This is a test',
    version='0.1.0'
)
app.mount('/static', StaticFiles(directory='static'), name='static')

@app.get('/')
def index():
    return RedirectResponse(url='/static/index.html')

@app.get('/datasets')
def list_datasets():
    return db.datasetList()

@app.get('/datasets/{label}')
def get_dataset(label: str):
    checkLabel(label)
    return db[label]['meta']
@app.post('/datasets/{label}', status_code=201)
def create_dataset(label: str):
    db.createDataset(label)
    db.save(label)
    return db[label]['meta']
@app.delete('/datasets/{label}')
def delete_dataset(label: str):
    db.purgeDataset(label)

class TreeSource(str, Enum):
    newick = 'newick'
    otf2 = 'otf2'
    graph = 'graph'
@app.get('/datasets/{label}/tree')
def get_tree(label: str, source: TreeSource = TreeSource.newick):
    checkLabel(label)
    if source not in db[label]['trees']:
        raise HTTPException(status_code=404, detail='Dataset does not contain %s tree data' % source.value)
    return db[label]['trees'][source]
@app.post('/datasets/{label}/tree')
async def add_newick_tree(label: str, file: UploadFile = File(...)):
    checkLabel(label)
    # TODO: stream the log back
    log = ''
    def logToClient(value, end='\n'):
        nonlocal log
        log += value + end
    db.addSourceFile(label, file.filename, 'newick')
    db.processNewickTree(label, (await file.read()).decode(), logToClient)
    db.save(label)
    return log

@app.get('/datasets/{label}/physl')
def get_physl(label: str):
    checkLabel(label)
    if 'physl' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not include physl source code')
    return db[label]['physl']
@app.get('/datasets/{label}/python')
def get_python(label: str):
    checkLabel(label)
    if 'python' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not include python source code')
    return db[label]['python']
@app.get('/datasets/{label}/cpp')
def get_cpp(label: str):
    checkLabel(label)
    if 'cpp' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not include C++ source code')
    return db[label]['cpp']

@app.get('/datasets/{label}/primitives')
def primitives(label: str):
    checkLabel(label)
    return dict(db[label]['primitives'])

class HistogramMode(str, Enum):
    utilization = 'utilization'
    count = 'count'
@app.get('/datasets/{label}/histogram')
def histogram(label: str, \
              mode: HistogramMode = HistogramMode.utilization, \
              bins: int = 100, \
              begin: float = None, \
              end: float = None, \
              location: str = None, \
              primitive: str = None):
    checkLabel(label)
    if 'intervalIndexes' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not contain indexed interval data')

    def modeHelper(indexObj):
        # TODO: respond with a 204 when the histogram is empty
        # (d3.js doesn't have a good way to handle 204 error codes)
        # if indexObj.is_empty():
        #    raise HTTPException(status_code=204, detail='An index exists for the query, but it is empty')
        return getattr(indexObj, 'compute%sHistogram' % (mode.title()))(bins, begin, end)

    if location is not None:
        if location not in db[label]['intervalIndexes']['locations']:
            raise HTTPException(status_code=404, detail='No index for location: %s' % location)
        if primitive is not None:
            if primitive not in db[label]['intervalIndexes']['both'][location]:
                raise HTTPException(status_code=404, detail='No index for location, primitive combination: %s, %s' % (location, primitive))
            return modeHelper(db[label]['intervalIndexes']['both'][location][primitive])
        return modeHelper(db[label]['intervalIndexes']['locations'][location])
    if primitive is not None:
        if primitive not in db[label]['intervalIndexes']['primitives']:
            raise HTTPException(status_code=404, detail='No index for primitive: %s' % primitive)
        return modeHelper(db[label]['intervalIndexes']['primitives'][primitive])
    return modeHelper(db[label]['intervalIndexes']['main'])

@app.get('/datasets/{label}/intervals')
def intervals(label: str, begin: float = None, end: float = None):
    checkLabel(label)
    if 'intervalIndexes' not in db[label]:
        raise HTTPException(status_code=404, detail='Dataset does not contain indexed interval data')

    if begin is None:
        begin = db[label]['intervalIndexes']['main'].top_node.begin
    if end is None:
        end = db[label]['intervalIndexes']['main'].top_node.end

    def intervalGenerator():
        yield '['
        firstItem = True
        for i in db[label]['intervalIndexes']['main'].iterOverlap(begin, end):
            if not firstItem:
                yield ','
            yield json.dumps(db[label]['intervals'][i.data])
            firstItem = False
        yield ']'
    return StreamingResponse(intervalGenerator(), media_type='application/json')

if __name__ == '__main__':
    uvicorn.run(app)
