from enum import Enum

from fastapi import APIRouter, File, UploadFile, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from starlette.requests import Request
from starlette.responses import RedirectResponse, StreamingResponse

from . import db, validateDataset, getSanitizedDatasetInfo, ClientLogger

router = APIRouter()

def iterUploadFile(text):
    for line in text.decode().splitlines():
        yield line

@router.get('/')
def index():
    return RedirectResponse(url='/static/index.html')


@router.get('/datasets')
def list_datasets():
    return [getSanitizedDatasetInfo(dataset['info']['datasetId']) for dataset in db]

@router.get('/datasets/{datasetId}')
def get_dataset(datasetId: str):
    datasetId = validateDataset(datasetId)
    return getSanitizedDatasetInfo(datasetId)

class BasicDataset(BaseModel):
    # TODO: ideally, these should all be UploadFile arguments instead of
    # expecting pre-parsed strings, however, AFAIK there isn't a FastAPI way to
    # allow optional UploadFile arguments
    label: str = 'Untitled dataset'
    newick: str = None
    csv: str = None
    dot: str = None
    physl: str = None
    python: str = None
    cpp: str = None
    tags: list = None

@router.post('/datasets', status_code=201)
def create_dataset(dataset: BasicDataset = None):
    logger = ClientLogger()

    async def startProcess():
        datasetId = db.createDataset()['info']['datasetId']
        logger.addMetadata('datasetId', datasetId)
        if dataset:
            if dataset.tags:
                tags = {t : True for t in dataset.tags}
                db.addTags(datasetId, tags)
            if dataset.newick:
                db.addSourceFile(datasetId, dataset.label + '.newick', 'newick')
                await db.processNewickTree(datasetId, dataset.newick, logger.log)
                db.finishLoadingSourceFile(datasetId, dataset.label + '.newick')
            if dataset.csv:
                db.addSourceFile(datasetId, dataset.label + '.csv', 'csv')
                await db.processCsv(datasetId, iter(dataset.csv.splitlines()), logger.log)
                db.finishLoadingSourceFile(datasetId, dataset.label + '.csv')
            if dataset.dot:
                db.addSourceFile(datasetId, dataset.label + '.dot', 'dot')
                await db.processDot(datasetId, iter(dataset.dot.splitlines()), logger.log)
                db.finishLoadingSourceFile(datasetId, dataset.label + '.dot')
            if dataset.physl:
                db.processCode(datasetId, dataset.label + '.physl', dataset.physl.splitlines(), 'physl')
                await logger.log('Loaded physl code')
            if dataset.python:
                db.processCode(datasetId, dataset.label + '.py', dataset.python.splitlines(), 'python')
                await logger.log('Loaded python code')
            if dataset.cpp:
                db.processCode(datasetId, dataset.label + '.cpp', dataset.cpp.splitlines(), 'cpp')
                await logger.log('Loaded C++ code')

        await db.save(datasetId, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')

@router.delete('/datasets/{datasetId}')
def delete_dataset(datasetId: str):
    datasetId = validateDataset(datasetId, allFilesMustBeReady=True)
    del db[datasetId]


class TreeSource(str, Enum):
    newick = 'newick'
    otf2 = 'otf2'
    graph = 'graph'

@router.get('/datasets/{datasetId}/tree')
def get_tree(datasetId: str, source: TreeSource = TreeSource.newick):
    datasetId = validateDataset(datasetId)
    if source not in db[datasetId]['trees']:
        raise HTTPException(status_code=404, detail='Dataset does not contain %s tree data' % source.value)
    return db[datasetId]['trees'][source]

@router.post('/datasets/{datasetId}/tree')
def add_newick_tree(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(datasetId, file.filename, 'newick')
        await db.processNewickTree(datasetId, (await file.read()).decode(), logger.log)
        db.finishLoadingSourceFile(datasetId, file.filename)
        await db.save(datasetId, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@router.post('/datasets/{datasetId}/csv')
def add_performance_csv(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(datasetId, file.filename, 'csv')
        await db.processCsv(datasetId, iterUploadFile(await file.read()), logger.log)
        db.finishLoadingSourceFile(datasetId, file.filename)
        await db.save(datasetId, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@router.post('/datasets/{datasetId}/dot')
def add_dot_graph(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(datasetId, file.filename, 'dot')
        await db.processDot(datasetId, iterUploadFile(await file.read()), logger.log)
        db.finishLoadingSourceFile(datasetId, file.filename)
        await db.save(datasetId, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@router.post('/datasets/{datasetId}/log')
def add_full_phylanx_log(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(datasetId, file.filename, 'log')
        await db.processPhylanxLog(datasetId, iterUploadFile(await file.read()), logger.log)
        db.finishLoadingSourceFile(datasetId, file.filename)
        await db.save(datasetId, logger.log)
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


class FakeOtf2File:  # pylint: disable=R0903
    def __init__(self, request):
        self.name = 'APEX.otf2'
        self.stream = request.stream()

    async def __aiter__(self):
        line = ''
        async for chunk in self.stream:
            line += chunk.decode()
            done = False
            while not done:
                done = True
                i = line.find('\n')
                if i >= 0:
                    yield line[0:i]
                    line = line[i+1:]
                    done = False

@router.post('/datasets/{datasetId}/otf2')
async def add_otf2_trace(datasetId: str, request: Request):  # request: Request
    datasetId = validateDataset(datasetId)
    logger = ClientLogger()

    async def startProcess():
        db.addSourceFile(datasetId, 'APEX.otf2', 'otf2')
        await db.processOtf2(datasetId, FakeOtf2File(request), logger.log)
        db.finishLoadingSourceFile(datasetId, 'APEX.otf2')
        logger.finish()

    return StreamingResponse(logger.iterate(startProcess), media_type='text/text')


@router.get('/datasets/{datasetId}/physl')
def get_physl(datasetId: str):
    datasetId = validateDataset(datasetId, requiredFiles=['physl'], filesMustBeReady=['physl'])
    return db[datasetId]['physl']


@router.post('/datasets/{datasetId}/physl')
async def add_physl(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    db.processCode(datasetId, file.filename, iterUploadFile(await file.read()), 'physl')
    await db.save(datasetId)


@router.get('/datasets/{datasetId}/python')
def get_python(datasetId: str):
    print('python endpoint', datasetId)
    datasetId = validateDataset(datasetId, requiredFiles=['python'], filesMustBeReady=['python'])
    return db[datasetId]['python']

@router.post('/datasets/{datasetId}/python')
async def add_python(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    db.processCode(datasetId, file.filename, iterUploadFile(await file.read()), 'python')
    await db.save(datasetId)


@router.get('/datasets/{datasetId}/cpp')
def get_cpp(datasetId: str):
    datasetId = validateDataset(datasetId, requiredFiles=['cpp'], filesMustBeReady=['cpp'])
    return db[datasetId]['cpp']


@router.post('/datasets/{datasetId}/cpp')
async def add_cpp(datasetId: str, file: UploadFile = File(...)):
    datasetId = validateDataset(datasetId)
    db.processCode(datasetId, file.filename, iterUploadFile(await file.read()), 'cpp')
    await db.save(datasetId)


@router.put('/datasets/{datasetId}/info')
async def update_info(datasetId: str, label: Optional[str] = None, tags: Optional[str] = None):
    datasetId = validateDataset(datasetId)
    if label is not None:
        db.rename(datasetId, label)
    if tags is not None:
        if not tags:
            db.setTags(datasetId, {})
        else:
            db.setTags(datasetId, dict.fromkeys(tags.split(','), True))

@router.post('/tags/{tag}')
async def add_tag(tag: str):
    db.addTagToAllDatasets(tag)
