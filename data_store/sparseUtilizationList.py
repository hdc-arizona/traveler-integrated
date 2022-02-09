# Imports
import copy

import numpy as np
import json
from profiling_tools._cCalcBin import ffi, lib

class SparseUtilizationList():
    def __init__(self, isUpdate=True):
        self.locationDict = dict()
        self.cLocationDict = dict()
        self.isUpdateCounter = isUpdate

    def getCLocation(self, loc):
        return self.cLocationDict[loc]

    def setCLocation(self, loc, val):
        self.cLocationDict[loc] = copy.deepcopy(val)

    def sortAtLoc(self, loc):
        self.locationDict[loc].sort(key=lambda x: x['index'])

    def finalize(self, allLocations, isCumulative=False):
        for loc in allLocations:
            if loc in self.locationDict:
                self.sortAtLoc(loc)
            self.locationDict[loc] = np.array(self.locationDict.get(loc, []))

            length = len(self.locationDict[loc])
            if self.isUpdateCounter:
                counter = 0
                for i, criticalPt in enumerate(self.locationDict[loc]):
                    counter += criticalPt['counter']
                    criticalPt['counter'] = counter
                    if i == 0:
                        criticalPt['util'] = self.calcCurrentUtil(criticalPt['index'], None)
                    else:
                        criticalPt['util'] = self.calcCurrentUtil(criticalPt['index'], self.locationDict[loc][i-1])

            locStruct = {'index': np.empty(length, dtype=np.int64), 'counter': np.empty(length, dtype=np.int64), 'util': np.zeros(length, dtype=np.double)}
            for i in range(length):
                locStruct['index'][i] = self.locationDict[loc][i]['index']
                locStruct['counter'][i] = self.locationDict[loc][i]['counter']
                locStruct['util'][i] = self.locationDict[loc][i]['util']
                if isCumulative is True and i > 0:
                    locStruct['util'][i] = locStruct['util'][i] + locStruct['util'][i-1]
            self.setCLocation(loc, locStruct)

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
            else:
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
                    if location_struct_index[location] > 0:
                        startIndex = self.locationDict[location][location_struct_index[location]-1]['index']
                    else:
                        startIndex = 0
                    if locStruct['primitive'] == primitive and locStruct['counter'] == 0:
                        if startIndex < criticalPts:
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
