# Imports
import numpy as np
import json
from .loggers import logToConsole

class SparseUtilizationList():
    def __init__(self, locationDict={}):
        self.locationDict = locationDict

    def __getitem__(self, loc):
        return self.locationDict[loc]

    def sortAtLoc(self, loc):
        self.locationDict[loc].sort(key=lambda x: x['index'])
        return

    def calcCurrentUtil(self, location, index, prior):
        if prior is None:
            last = {'index': 0, 'counter': 0, 'util':0}
        else:
            # last = self.locationDict[location][arrIndex-1]
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
        pass

    # Calulates utilization for one location in a Gantt chart
    # Location designates a particular CPU or Thread and denotes the y-axis on the Gantt Chart
    def calcUtilizationForLocation(self, bins=100, begin=None, end=None, Location=None):
        rangePerBin = (end-begin)/bins

        # caclulates the beginning of each each bin evenly divided over the range of
        # time indicies and stores them as critical points
        criticalPts = []
        for i in range(0, bins):
            criticalPts.append({"index":(i * rangePerBin) + begin})
        criticalPts.append({"index": end})

        # searches
        histogram = []
        for i in criticalPts:
            priorRecord = next(x for x in self.locationDict[Location] if i['index'] <= x['index'])
            histogram.append({'index': i['index'], 'util': self.calcCurrentUtil(Location, i['index'], priorRecord)})

        for i, bin in enumerate(histogram):
            if i is 0:
                histogram[i]['integral'] = bin['util'] / bin['index']
            else:
                histogram[i]['integral'] = (bin['util'] - histogram[i-1]['util']) / (bin['index'] - histogram[i-1]['index'])

        print(histogram)
        return histogram



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
                criticalPt['util'] = sul.calcCurrentUtil(loc, criticalPt['index'], None)
            else:
                criticalPt['util'] = sul.calcCurrentUtil(loc, criticalPt['index'], sul.locationDict[loc][i-1])



    db[label]['sparseUtilizationList'] = sul

    return
