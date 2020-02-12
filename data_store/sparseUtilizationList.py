# Imports
import numpy as np
import json
from .loggers import logToConsole
from bisect import bisect_left

class SparseUtilizationList():
    def __init__(self, locationDict={}):
        self.locationDict = locationDict

    def __getitem__(self, loc):
        return self.locationDict[loc]


    # Returns index of x in arr if present, else -1
    # Modified to work with dictionaries
    def binarySearch (self, arr, l, r, x):
        while True:
            # Check base case
            if r >= l:

                mid = l + (r - l)//2

                # If element is present at the middle itself
                if arr[mid]['index'] == x:
                    return mid

                elif x < arr[mid]['index'] and x > arr[mid-1]['index']:
                    return mid-1

                # If element is smaller than mid, then it can only
                # be present in left subarray
                elif arr[mid]['index'] > x:
                    r = mid-1
                    continue
                    # return self.binarySearch(arr, l, mid-1, x)

                # Else the element can only be present in right subarray
                else:
                    l = mid+1
                    continue
                    # return self.binarySearch(arr, mid+1, r, x)


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

        array = np.zeros(bins)
        for location in self.locationDict:
            temp = self.calcUtilizationForLocation(bins, begin, end, location)[1] #the second value returned is only an array of integrals
            array = np.add(array, temp)

        return array


    # Calulates utilization for one location in a Gantt chart
    # Location designates a particular CPU or Thread and denotes the y-axis on the Gantt Chart
    def calcUtilizationForLocation(self, bins=100, begin=None, end=None, Location=None):
        rangePerBin = (end-begin)/bins
        onlyIntegrals =[]

        # caclulates the beginning of each each bin evenly divided over the range of
        # time indicies and stores them as critical points
        criticalPts = []
        for i in range(0, bins):
            criticalPts.append((i * rangePerBin) + begin)
        criticalPts.append(end)

        # searches
        histogram = []
        location = self.locationDict[Location]
        length = len(location)
        nextRecordIndex = 0
        for pt in criticalPts:
            if pt < location[0]['index']:
                histogram.append({'index': pt, 'counter':0, 'util': 0})
            else:
                nextRecordIndex = self.binarySearch(location, nextRecordIndex, length, pt)
                # nextRecordIndex = next(i for i, event in enumerate(self.locationDict[Location]) if event['index'] > pt['index'])
                #
                # if not (nextRecordIndex-1 == nextRecordIndexB):
                #     print(i, nextRecordIndex, nextRecordIndexB, pt['index'], self.locationDict[Location][nextRecordIndexB])
                # else:
                #     print(i, nextRecordIndex, nextRecordIndexB, pt['index'],  self.locationDict[Location][nextRecordIndexB])

                priorRecord = location[nextRecordIndex]
                histogram.append({'index': pt, 'counter': priorRecord['counter'], 'util': self.calcCurrentUtil(pt, priorRecord)})

        histogram[0]['integral'] = 0
        prev = histogram[0]
        for i in range(1,len(histogram)):
            current = histogram[i]
            val = (current['util'] - prev['util']) / (current['index'] - prev['index'])
            current['integral'] = val
            # onlyIntegrals.append(val)
            prev = current
        #for i, bin in enumerate(histogram):
        #    if i is 0:
        #        histogram[i]['integral'] = 0 #bin['util'] / bin['index']
        #    else:
        #        histogram[i]['integral'] = (bin['util'] - histogram[i-1]['util']) / (bin['index'] - histogram[i-1]['index'])
        #        onlyIntegrals.append( (bin['util'] - histogram[i-1]['util']) / (bin['index'] - histogram[i-1]['index']) )

        return (histogram, list(current['integral'] for current in histogram[1:]))



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
            sul.setIntervalAtLocation({'index':int(i.begin), 'counter': 1, 'util': None}, loc)
            sul.setIntervalAtLocation({'index':int(i.end), 'counter': -1, 'util': None}, loc)

        sul.sortAtLoc(loc)

        for i, criticalPt in enumerate(sul[loc]):
            counter += criticalPt['counter']
            criticalPt['counter'] = counter
            if i is 0:
                criticalPt['util'] = sul.calcCurrentUtil(criticalPt['index'], None)
            else:
                criticalPt['util'] = sul.calcCurrentUtil(criticalPt['index'], sul.locationDict[loc][i-1])



    db[label]['sparseUtilizationList'] = sul

    return
