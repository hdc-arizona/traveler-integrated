#!/usr/bin/env python3
import argparse
import uvicorn
from fastapi import FastAPI, HTTPException
from starlette.staticfiles import StaticFiles
from starlette.responses import RedirectResponse
# from bplustree import BPlusTree
from wrangling import common

parser = argparse.ArgumentParser(description='Serve data bundled by bundle.py')
parser.add_argument('-d', '--db_dir', dest='dbDir', default='/tmp/traveler-integrated',
                    help='Directory where the bundled data is stored (default: /tmp/traveler-integrated')

args = parser.parse_args()
db = common.loadDatabase(args.dbDir)
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
def datasets():
    result = {}
    for label, data in db.items():
        result[label] = dict(data['meta'])
    return result

@app.get('/tree/{label}')
def tree(label: str):
    if label not in db:
        raise HTTPException(status_code=404, detail='Tree not found')
    return db[label]['meta']['coreTree']

@app.get('/regions/<label>')
def regions(label: str):
    if label not in db:
        raise HTTPException(status_code=404, detail='Region not found')
    return dict(db[label]['regions'])

# TODO: add endpoints for querying ranges, guids, and maybe individual events

if __name__ == '__main__':
    uvicorn.run(app)
