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

@router.get('/datasets/{datasetId}/primitives/{primitive}/utilization')
def getUtilizationForPrimitive(datasetId: str,
                               primitive: str,
                               bins: int = 100,
                               begin: int = None,
                               end: int = None,
                               duration_bins: int = 100):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    durationBegin = int(db[datasetId]['info']['intervalDurationDomain'][primitive][0])
    durationEnd = int(db[datasetId]['info']['intervalDurationDomain'][primitive][1])
    ret = {'data': db[datasetId]['sparseUtilizationList']['intervals'].calcUtilizationForPrimitive(bins,
                                                                                               begin,
                                                                                               end,
                                                                                               primitive,
                                                                                               durationBegin,
                                                                                               durationEnd,
                                                                                               duration_bins),
           'metadata': {'begin': begin, 'end': end, 'bins': bins}}
    return ret

@router.get('/datasets/{datasetId}/primitives/{primitive}/intervalHistogram')
def getIntervalHistogram(datasetId: str,
                         primitive: str = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    return db[datasetId]['intervalHistograms'].get(primitive, {})
