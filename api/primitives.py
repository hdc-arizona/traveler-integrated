from fastapi import APIRouter

from . import db, validateDataset

router = APIRouter()

@router.get('/datasets/{datasetId}/primitives')
def get_primitives(datasetId: str):
    datasetId = validateDataset(datasetId)
    return dict(db[datasetId]['primitives'])

@router.get('/datasets/{datasetId}/primitives/{primitive}')
def get_primitive(datasetId: str, primitive: str):
    datasetId = validateDataset(datasetId)
    return db[datasetId]['primitives'][primitive]
