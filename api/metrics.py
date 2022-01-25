import json

from fastapi import APIRouter, HTTPException
from starlette.responses import StreamingResponse

from . import db, validateDataset

router = APIRouter()

@router.get('/datasets/{datasetId}/metrics')
def get_procMetrics(datasetId: str):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'])
    return db[datasetId]['info']['procMetricList']

@router.get('/datasets/{datasetId}/metrics/raw')
def get_procMetric_values(datasetId: str,
                          metric: str,
                          begin: float = None,
                          end: float = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    def procMetricGenerator():
        yield '['
        firstItem = True
        for timestamp in db[datasetId]['procMetrics'][metric]:
            if float(timestamp) < begin or float(timestamp) > end:
                continue
            if not firstItem:
                yield ','
            yield json.dumps(db[datasetId]['procMetrics'][metric][timestamp])
            firstItem = False
        yield ']'

    return StreamingResponse(procMetricGenerator(), media_type='application/json')

@router.get('/datasets/{datasetId}/metrics/{metric}/summary')
def getMetricData(datasetId: str,
                  metric: str,
                  bins: int = 100,
                  begin: int = None,
                  end: int = None,
                  location: str = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    ret = {}
    if location is None:
        ret['data'] = db[datasetId]['sparseUtilizationList']['metrics'][metric].calcMetricHistogram(bins, begin, end)
    else:
        ret['data'] = db[datasetId]['sparseUtilizationList']['metrics'][metric].calcMetricHistogram(bins, begin, end, location)
    ret['metadata'] = {'begin': begin, 'end': end, 'bins': bins}
    return ret

@router.get('/datasets/{datasetId}/utilizationHistogram')
def get_utilization_histogram(datasetId: str,
                              bins: int = 100,
                              begin: int = None,
                              end: int = None,
                              locations: str = None,
                              primitive: str = None):
    datasetId = validateDataset(datasetId, requiredFiles=['otf2'], filesMustBeReady=['otf2'])

    if begin is None:
        begin = db[datasetId]['info']['intervalDomain'][0]
    if end is None:
        end = db[datasetId]['info']['intervalDomain'][1]

    ret = {}

    if locations:
        locations = locations.split(',')

    if primitive is not None:
        if primitive not in db[datasetId]['sparseUtilizationList']['primitives']:
            raise HTTPException(status_code=404, detail='No utilization data for primitive: %s' % primitive)
        if locations:
            ret['locations'] = {}
            for location in locations:
                ret['locations'][location] = db[datasetId]['sparseUtilizationList']['primitives'][primitive].calcUtilizationForLocation(bins, begin, end, location)
        else:
            ret['data'] = db[datasetId]['sparseUtilizationList']['primitives'][primitive].calcUtilizationHistogram(bins, begin, end)
    elif locations:
        ret['locations'] = {}
        for location in locations:
            ret['locations'][location] = db[datasetId]['sparseUtilizationList']['intervals'].calcUtilizationForLocation(bins, begin, end, location)
    else:
        ret['data'] = db[datasetId]['sparseUtilizationList']['intervals'].calcUtilizationHistogram(bins, begin, end)

    ret['metadata'] = {'begin': begin, 'end': end, 'bins': bins}
    return ret
