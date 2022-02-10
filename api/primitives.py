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

@router.get('/datasets/{datasetId}/getUtilizationForPrimitive')
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

# @router.get('/datasets/{datasetId}/primitives/{primitive}/intervalHistogram')
# def getIntervalHistogram(datasetId: str,
#                          primitive: str):
#     datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])
#
#     if begin is None:
#         begin = db[datasetId]['info']['intervalDomain'][0]
#     if end is None:
#         end = db[datasetId]['info']['intervalDomain'][1]
#
#     return db[datasetId]['intervalHistograms'].get(primitive, {})

@router.get('/datasets/{datasetId}/intervalHistograms')
def getIntervalHistogram(datasetId: str, bins: int = 100, begin: int = None, end: int = None, primitive: str = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])
    if primitive is None or primitive == '':
        primitive = 'all_primitives'

    if begin is None:
        begin = int(db[datasetId]['info']['intervalDurationDomain'][primitive][0])
    if end is None:
        end = int(db[datasetId]['info']['intervalDurationDomain'][primitive][1])

    ret = {'data': db[datasetId]['sparseUtilizationList']['intervalHistograms'][primitive].calcIntervalHistogram(bins, begin, end),
           'metadata': {'begin': begin, 'end': end, 'bins': bins}}
    return ret

@router.get('/datasets/{datasetId}/getIntervalList')
def getIntervalList(datasetId: str, \
                    begin: int = None, \
                    end: int = None, \
                    enter: int = None, \
                    leave: int = None, \
                    locations: str = None, \
                    primitive: str = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    locList = {}
    if enter is None:
        return locList

    if leave is None:
        leave = enter + 1

    if locations:
        locations = locations.split(',')

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    for i in db[datasetId]['intervalIndex'].iterOverlap(begin, end):
        cur = db[datasetId]['intervals'][i.data]
        if cur['Location'] not in locations or (primitive != 'all_primitives' and primitive != cur['Primitive']):
            continue
        interval_length = (cur['leave']['Timestamp'] - cur['enter']['Timestamp'])
        if enter <= interval_length <= leave:
            if cur['Location'] not in locList:
                locList[cur['Location']] = list()
            locList[cur['Location']].append({'begin': cur['enter']['Timestamp'], 'end': cur['leave']['Timestamp']})
    return locList