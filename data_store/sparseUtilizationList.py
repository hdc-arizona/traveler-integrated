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

    def __setitem__(self, loc, val):
        self.locationDict[loc] = val

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

        array = np.zeros(bins)
        for location in self.locationDict:
            temp = self.calcUtilizationForLocation(bins, begin, end, location)[1] #the second value returned is only an array of integrals
            array = np.add(array, temp)

        return array


    # Calulates utilization for one location in a Gantt chart
    # Location designates a particular CPU or Thread and denotes the y-axis on the Gantt Chart
    def calcUtilizationForLocation(self, bins=100, begin=None, end=None, Location=None):
        rangePerBin = (end-begin)/bins

        # caclulates the beginning of each each bin evenly divided over the range of
        # time indicies and stores them as critical points
        criticalPts = np.empty(bins+1)
        for i in range(0, bins):
            criticalPts[i] = (i * rangePerBin) + begin
        criticalPts[len(criticalPts)-1] = end

        # searches
        histogram = np.empty_like(criticalPts, dtype=object)
        location = self.locationDict[Location]
        length = len(location) - 1
        nextRecordIndex = 0

        # we want to replace this call to C
        # we can create three arrays to replace these dictionary objects when passing over
        # three num py arrays intergers and floats
        # -> we pass array of critical points
        # From c we are writing back into our 3 arrays
        # Basically passing in 5 pointers to arrays in and prof_output

        # This way forces allocation and deallocation to occur in python
        # This makes out lives easier
        # Calling malloc can be slow

        # Search fo C code  <-> python code integration
        # CTypes?

        # We need to be considerate when compiling this to a libaray and make it sympathetic to dynamic loading etc.
        # Boost for this? Boost.python
        # Getting them to work together may be really rough; but could be worth an investment if we do this a lot

        #CFFI Python
            # Put a serving into a script that also does our library compilation beforehand
            # Start with small self contained python and c-scripts toy examples and work up to this

        for i, pt in enumerate(criticalPts):
            if pt < location[0]['index']:
                histogram[i] = {'index': pt, 'counter':0, 'util': 0} #This has overhead of creating a disctionary each time; looks nice but can be slow
            else:
                nextRecordIndex = self.binarySearch(location, nextRecordIndex, length, pt)
                priorRecord = location[nextRecordIndex]

                # pulling out of calc current util to reduce overhead
                if priorRecord is None:
                    last = {'index': 0, 'counter': 0, 'util': 0}
                else:
                    last = priorRecord

                util = (((pt - last['index']) * last['counter'])+last['util'])

                histogram[i] = {'index': pt, 'counter': priorRecord['counter'], 'util': util}

        histogram[0]['integral'] = 0
        prev = histogram[0]
        for i in range(1,len(histogram)):
            current = histogram[i]
            val = (current['util'] - prev['util']) / (current['index'] - prev['index'])
            current['integral'] = val
            prev = current

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
        sul[loc] = np.array(sul[loc])

        for i, criticalPt in enumerate(sul[loc]):
            counter += criticalPt['counter']
            criticalPt['counter'] = counter
            if i is 0:
                criticalPt['util'] = sul.calcCurrentUtil(criticalPt['index'], None)
            else:
                criticalPt['util'] = sul.calcCurrentUtil(criticalPt['index'], sul.locationDict[loc][i-1])



    db[label]['sparseUtilizationList'] = sul

    return
