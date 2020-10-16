# Imports
import copy

import numpy as np
import json
from .loggers import logToConsole
from profiling_tools._cCalcBin import ffi, lib

class SparseUtilizationList():
    def __init__(self):
        self.locationDict = dict()
        self.cLocationDict = dict()

    def getCLocation(self, loc):
        return self.cLocationDict[loc]

    def setCLocation(self, loc, val):
        self.cLocationDict[loc] = copy.deepcopy(val)

    def sortAtLoc(self, loc):
        self.locationDict[loc].sort(key=lambda x: x['index'])

    def calcCurrentUtil(self, index, prior):
        if prior is None:
            last = {'index': 0, 'counter': 0, 'util': 0}
        else:
            last = prior

        return (((index - last['index']) * last['counter'])+last['util'])

    def setIntervalAtLocation(self, edgeUtilObj, location):
        # check if array exists
        if location not in self.locationDict:
            self.locationDict[location] = []

        self.locationDict[location].append(edgeUtilObj)
        return

    # Calculates utilization histogram for all intervals regardless of location
    def calcGanttHistogram(self, bins=100, begin=None, end=None):
        listOfLocations = []

        for location in self.locationDict:
            temp = self.calcUtilizationForLocation(bins, begin, end, location)
            listOfLocations.append({"location":location, "histogram":temp})

        return listOfLocations

    # Calculates utilization histogram for all intervals regardless of location
    def calcUtilizationHistogram(self, bins=100, begin=None, end=None, isInterval=True):
        array = []
        isFirst = True
        for location in self.locationDict:
            temp = self.calcUtilizationForLocation(bins, begin, end, location, isInterval)
            if isFirst is True:
                isFirst = False
                array = temp
            for i in range(bins):
                array[i] = array[i] + temp[i]

        return array

    # Calculates metric histogram
    def calcMetricHistogram(self, bins=100, begin=None, end=None, location=None):
        array = []
        if location is not None:
            return self.calcUtilizationForLocation(bins, begin, end, location, False)
        for location in self.locationDict:
            temp = self.calcUtilizationForLocation(bins, begin, end, location, False)
            array.append(temp)
        array = np.asarray(array)
        avgArray = np.mean(array, axis=0)
        minArray = np.amin(array, axis=0)
        maxArray = np.amax(array, axis=0)
        stdArray = np.std(array, axis=0)
        return {"min": minArray.tolist(), "max": maxArray.tolist(), "average": avgArray.tolist(), "std": stdArray.tolist()}

    # Calculates histogram for interval duration
    def calcIntervalHistogram(self, bins=100, begin=None, end=None):
        return self.calcUtilizationForLocation(bins, begin, end, 1, False)

    # Calculates utilization for one location in a Gantt chart
    # Location designates a particular CPU or Thread and denotes the y-axis on the Gantt Chart
    def calcUtilizationForLocation(self, bins=100, begin=None, end=None, Location=None, isInterval=True):
        rangePerBin = (end-begin)/bins

        # caclulates the beginning of each each bin evenly divided over the range of
        # time indicies and stores them as critical points
        criticalPts = np.empty(bins + 1, dtype=np.int64)
        critical_length = len(criticalPts)
        critical_points = ffi.new("long long[]", critical_length)
        for i in range(0, bins):
            criticalPts[i] = (i * rangePerBin) + begin
            critical_points[i] = int((i * rangePerBin) + begin)
        criticalPts[len(criticalPts)-1] = end
        critical_points[len(criticalPts)-1] = end

        # searches
        histogram = np.empty_like(criticalPts, dtype=object)
        location = self.locationDict[Location]
        length = len(location)
        histogram_length = len(histogram)

        histogram_index = ffi.new("long long[]", histogram_length)
        histogram_counter = ffi.new("long long[]", histogram_length)
        histogram_util = ffi.new("double[]", histogram_length)

        cLocationStruct = self.getCLocation(Location)
        location_index = ffi.cast("long long*", cLocationStruct['index'].ctypes.data)
        location_counter = ffi.cast("long long*", cLocationStruct['counter'].ctypes.data)
        location_util = ffi.cast("double*", cLocationStruct['util'].ctypes.data)

        lib.calcHistogram(histogram_counter, histogram_length, histogram_index, histogram_util, critical_points, critical_length, location_index, length-1, location_counter, location_util)
        histogram[0] = {'integral': 0, 'index': histogram_index[0], 'util': histogram_util[0], 'counter': histogram_counter[0]}
        prev = histogram[0]
        prettyHistogram = []
        for i in range(1, len(histogram)):
            histogram[i] = {'index': histogram_index[i], 'util': histogram_util[i], 'counter': histogram_counter[i]}
            current = histogram[i]
            val = current['util']
            if isInterval:
                val = (current['util'] - prev['util']) / (current['index'] - prev['index'])
            current['integral'] = val
            prev = current
            prettyHistogram.append(histogram[i]['integral'])
        return prettyHistogram

    # Calculates utilization for each primitive and returns util per duration
    def calcUtilizationForPrimitive(self, bins=100,
                                    begin=None,
                                    end=None,
                                    primitive=None,
                                    durationBegin=None,
                                    durationEnd=None,
                                    durationBins=100):
        primitiveCountPerBin = np.zeros((bins, durationBins+1), dtype=np.double)
        rangePerBin = (end-begin)/bins
        rangePerDurationBin = (durationEnd-durationBegin)/durationBins
        location_struct_index = dict()
        location_struct_length = dict()
        preCriticalPts = begin
        for i in range(1, bins):
            criticalPts = (i * rangePerBin) + begin

            for location in self.locationDict:
                if location not in location_struct_index:
                    location_struct_index[location] = 0
                if location not in location_struct_length:
                    location_struct_length[location] = len(self.locationDict[location])

                while location_struct_index[location] < location_struct_length[location]:
                    locStruct = self.locationDict[location][location_struct_index[location]]
                    # since its sorted per location, all end indexes are from the same interval of previous enter index
                    startIndex = self.locationDict[location][location_struct_index[location]-1]['index']
                    if locStruct['primitive'] == primitive and locStruct['counter'] == 0 and startIndex < criticalPts:
                        intervalChunkStart = max(preCriticalPts, startIndex)
                        intervalChunkEnd = min(criticalPts, locStruct['index'])
                        currentUtil = intervalChunkEnd - intervalChunkStart  # it should cover left/right/full overlap cases
                        duration = locStruct['index'] - startIndex
                        durationIndex = int((duration - durationBegin) // rangePerDurationBin)
                        primitiveCountPerBin[i, durationIndex] = primitiveCountPerBin[i, durationIndex] + float(currentUtil)
                        if primitiveCountPerBin[i, durationIndex] < 0:
                            print("Error: negative Util found " + str(primitiveCountPerBin[i, durationIndex]))
                            return []
                        if locStruct['index'] > criticalPts:  # check this explicitly, you dont wanna increase the index number
                            break
                    location_struct_index[location] = location_struct_index[location] + 1

            preCriticalPts = criticalPts
        return primitiveCountPerBin.tolist()


# In charge of loading interval data into our integral list
# I have no idea how we want to load interval data :/
async def loadSUL(label, db, log=logToConsole):
    await log('Loading sparse utilization list.')

    # create sul obj
    sul = {'intervals': SparseUtilizationList(), 'metrics': dict(), 'intervalDuration': dict()}
    begin = db[label]['meta']['intervalDomain'][0]
    end = db[label]['meta']['intervalDomain'][1]
    preMetricValue = dict()
    intervalDuration = dict()

    def updateSULForInterval(event, cur_location):
        if 'metrics' in event:
            for k, value in event['metrics'].items():
                if k not in sul['metrics']:
                    sul['metrics'][k] = SparseUtilizationList()
                    preMetricValue[k] = {'Timestamp': 0, 'Value': 0}
                current_rate = (value - preMetricValue[k]['Value']) / (event['Timestamp'] - preMetricValue[k]['Timestamp'])
                sul['metrics'][k].setIntervalAtLocation({'index': int(event['Timestamp']), 'counter': 0, 'util': current_rate}, cur_location)
                preMetricValue[k]['Timestamp'] = event['Timestamp']
                preMetricValue[k]['Value'] = value

    def updateIntervalDuration(event):
        duration = event['leave']['Timestamp'] - event['enter']['Timestamp']
        if "Primitive" in event:
            if event['Primitive'] in intervalDuration:
                if duration in intervalDuration[event['Primitive']]:
                    intervalDuration[event['Primitive']][duration] = intervalDuration[event['Primitive']][duration] + 1
                else:
                    intervalDuration[event['Primitive']][duration] = 1
            else:
                intervalDuration[event['Primitive']] = dict()
                intervalDuration[event['Primitive']][duration] = 1

    # we extract relevant data from database
    for loc in db[label]['intervalIndexes']['locations']:
        counter = 0
        for i in db[label]['intervalIndexes']['locations'][loc].iterOverlap(begin, end):
            primitive_name = db[label]['intervals'][i.data]['Primitive']
            sul['intervals'].setIntervalAtLocation({'index': int(i.begin), 'counter': 1, 'util': 0, 'primitive': primitive_name}, loc)
            sul['intervals'].setIntervalAtLocation({'index': int(i.end), 'counter': -1, 'util': 0, 'primitive': primitive_name}, loc)
            updateSULForInterval(db[label]['intervals'][i.data]['enter'], loc)
            updateSULForInterval(db[label]['intervals'][i.data]['leave'], loc)
            updateIntervalDuration(db[label]['intervals'][i.data])

        sul['intervals'].sortAtLoc(loc)
        sul['intervals'].locationDict[loc] = np.array(sul['intervals'].locationDict[loc])
        for key in sul['metrics']:
            sul['metrics'][key].sortAtLoc(loc)
            sul['metrics'][key].locationDict[loc] = np.array(sul['metrics'][key].locationDict[loc])

        length = len(sul['intervals'].locationDict[loc])
        for i, criticalPt in enumerate(sul['intervals'].locationDict[loc]):
            counter += criticalPt['counter']
            criticalPt['counter'] = counter
            if i is 0:
                criticalPt['util'] = sul['intervals'].calcCurrentUtil(criticalPt['index'], None)
            else:
                criticalPt['util'] = sul['intervals'].calcCurrentUtil(criticalPt['index'], sul['intervals'].locationDict[loc][i-1])

        locStruct = {'index': np.empty(length, dtype=np.int64), 'counter': np.empty(length, dtype=np.int64), 'util': np.zeros(length, dtype=np.double)}
        for i in range(length):
            locStruct['index'][i] = sul['intervals'].locationDict[loc][i]['index']
            locStruct['counter'][i] = sul['intervals'].locationDict[loc][i]['counter']
            locStruct['util'][i] = sul['intervals'].locationDict[loc][i]['util']

        sul['intervals'].setCLocation(loc, locStruct)
        # print("interval loc struct initiated")

        for key in sul['metrics']:
            length = len(sul['metrics'][key].locationDict[loc])
            mlocStruct = {'index': np.empty(length, dtype=np.int64), 'counter': np.empty(length, dtype=np.int64), 'util': np.zeros(length, dtype=np.double)}
            for i in range(length):
                mlocStruct['index'][i] = sul['metrics'][key].locationDict[loc][i]['index']
                mlocStruct['counter'][i] = sul['metrics'][key].locationDict[loc][i]['counter']
                mlocStruct['util'][i] = sul['metrics'][key].locationDict[loc][i]['util']

            sul['metrics'][key].setCLocation(loc, mlocStruct)
        # print("metric loc struct initiated")

    dummyLocation = 1
    intervalDurationDomainDict = dict()
    for primitive in intervalDuration:
        sul['intervalDuration'][primitive] = SparseUtilizationList()
        for ind, value in intervalDuration[primitive].items():
            sul['intervalDuration'][primitive].setIntervalAtLocation({'index': int(ind), 'counter': 0, 'util': value}, dummyLocation)

        sul['intervalDuration'][primitive].sortAtLoc(dummyLocation)
        length = len(sul['intervalDuration'][primitive].locationDict[dummyLocation])
        intervalDurationDomainDict[primitive] = [
            sul['intervalDuration'][primitive].locationDict[dummyLocation][0]['index'],
            sul['intervalDuration'][primitive].locationDict[dummyLocation][length-1]['index']
        ]
        sul['intervalDuration'][primitive].locationDict[dummyLocation] = np.array(sul['intervalDuration'][primitive].locationDict[dummyLocation])
        LS = {'index': np.empty(length, dtype=np.int64), 'counter': np.empty(length, dtype=np.int64), 'util': np.zeros(length, dtype=np.double)}
        for i in range(length):
            LS['index'][i] = sul['intervalDuration'][primitive].locationDict[dummyLocation][i]['index']
            LS['counter'][i] = sul['intervalDuration'][primitive].locationDict[dummyLocation][i]['counter']
            LS['util'][i] = sul['intervalDuration'][primitive].locationDict[dummyLocation][i]['util']
            if i > 0:
                LS['util'][i] = LS['util'][i] + LS['util'][i-1]

        sul['intervalDuration'][primitive].setCLocation(dummyLocation, LS)
    db[label]['meta']['intervalDurationDomain'] = intervalDurationDomainDict
    db[label]['sparseUtilizationList'] = sul

    return
