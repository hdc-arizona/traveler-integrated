# Imports
import numpy as np
import json
from .loggers import logToConsole
from profiling_tools._cCalcBin import ffi, lib

class SparseUtilizationList():
    def __init__(self, locationDict={}):
        self.locationDict = locationDict
        self.cLocationDict = {}

    def __getitem__(self, loc):
        return self.locationDict[loc]

    def __setitem__(self, loc, val):
        self.locationDict[loc] = val

    def getCLocation(self, loc):
        return self.cLocationDict[loc]

    def setCLocation(self, loc, val):
        self.cLocationDict[loc] = val

    # Returns index of x in arr if present, else -1
    # Modified to work with dictionaries
    def binarySearch (self, arr, l, r, x):
        while True:
            # Check base case
            if r >= l:
                mid = ( l + ((r - l)  >> 1) )

                # If element is present at the middle itself
                midX = arr[mid]['index']
                if midX == x:
                    return mid

                elif x < midX and x > arr[mid-1]['index']:
                    return mid-1

                # If element is smaller than mid, then it can only
                # be present in left subarray
                elif midX > x:
                    r = mid-1
                    continue

                # Else the element can only be present in right subarray
                else:
                    l = mid+1
                    continue

            else:
                # Element is not present in the array
                # Return index to the left
                return r

    def sortAtLoc(self, loc):
        self.locationDict[loc].sort(key=lambda x: x['index'])
        return

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
    def calcUtilizationHistogram(self, bins=100, begin=None, end=None):

        array = []
        isFirst = True
        for location in self.locationDict:
            temp = self.calcUtilizationForLocation(bins, begin, end, location)
            if isFirst is True:
                isFirst = False
                array = temp
            for i in range(bins):
                array[i][2] = array[i][2] + temp[i][2]

        return array


    # Calulates utilization for one location in a Gantt chart
    # Location designates a particular CPU or Thread and denotes the y-axis on the Gantt Chart
    def calcUtilizationForLocation(self, bins=100, begin=None, end=None, Location=None):
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
        histogram_counter = ffi.new("int[]", histogram_length)
        histogram_util = ffi.new("double[]", histogram_length)

        # critical_points = ffi.new("int[]", critical_length)
        # for i in range(critical_length):
        #     critical_points[i] = criticalPts[i]

        cLocationStruct = self.getCLocation(Location)
        location_index = ffi.cast("long long*", cLocationStruct['index'].ctypes.data)
        location_counter = ffi.cast("int*", cLocationStruct['counter'].ctypes.data)
        location_util = ffi.cast("double*", cLocationStruct['util'].ctypes.data)

        lib.calcHistogram(histogram_counter, histogram_length, histogram_index, histogram_util, critical_points, critical_length, location_index, length-1, location_counter, location_util)

        histogram[0] = {'integral': 0, 'index': histogram_index[0], 'util': histogram_util[0], 'counter': histogram_counter[0]}
        prev = histogram[0]
        prettyHistogram = []
        for i in range(1, len(histogram)):
            histogram[i] = {'index': histogram_index[i], 'util': histogram_util[i], 'counter': histogram_counter[i]}
            current = histogram[i]
            val = (current['util'] - prev['util']) / (current['index'] - prev['index'])
            current['integral'] = val
            prev = current
            prettyHistogram.append([histogram[i-1]['index'], histogram[i]['index'], histogram[i]['integral']])
        return prettyHistogram


#Required args: metricName, begin, end, db, label
def computeMetricRate():

    # Calc and load per location
        # Extract relevant metric information between beginning and end of data (arg: begin&end)
            # define arbitry class method for loading metric data at a location
        # sorting
        # calc rate at point with class method
        # store all per location





# In charge of loading interval data into our integral list
# I have no idea how we want to load interval data :/
async def loadSUL(label, db, log=logToConsole):
    await log('Loading sparse utilization list.')
    # create sul obj
    sul = SparseUtilizationList()
    begin = db[label]['meta']['intervalDomain'][0]
    end = db[label]['meta']['intervalDomain'][1]

    # we extract relevant data from database
    # intervals
    for loc in db[label]['intervalIndexes']['locations']:
        counter = 0
        for i in db[label]['intervalIndexes']['locations'][loc].iterOverlap(begin, end):
            # first is timetamp, second is counter, third is total utilization at timestamp
            sul.setIntervalAtLocation({'index': int(i.begin), 'counter': 1, 'util': 0}, loc)
            sul.setIntervalAtLocation({'index': int(i.end), 'counter': -1, 'util': 0}, loc)

        sul.sortAtLoc(loc)
        sul[loc] = np.array(sul[loc])
        length = len(sul[loc])


        for i, criticalPt in enumerate(sul[loc]):
            counter += criticalPt['counter']
            criticalPt['counter'] = counter
            if i is 0:
                criticalPt['util'] = sul.calcCurrentUtil(criticalPt['index'], None)
            else:
                criticalPt['util'] = sul.calcCurrentUtil(criticalPt['index'], sul.locationDict[loc][i-1])

        locStruct = {'index': np.empty(length, dtype=np.int64), 'counter': np.empty(length, dtype=np.int32), 'util': np.zeros(length, dtype=np.double)}
        for i in range(length):
            locStruct['index'][i] = sul.locationDict[loc][i]['index']
            locStruct['counter'][i] = sul.locationDict[loc][i]['counter']
            locStruct['util'][i] = sul.locationDict[loc][i]['util']

            sul.setCLocation(loc, locStruct)

    db[label]['sparseUtilizationList'] = sul

    return
