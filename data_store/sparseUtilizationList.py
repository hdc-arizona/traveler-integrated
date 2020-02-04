# Imports
from DataStore import DataStore
import numpy as np

# In charge of loading interval data into our integral list
# I have no idea how we want to load interval data :/
async def loadSUL(label, db):
    # create sul obj
    sul = SparseUtilizationList()
    begin = db[label]['meta']['intervalDomain'][0]
    end = db[label]['meta']['intervalDomain'][1]

    # we extract relevant data from database
    # intervals
    for loc in db[label]['intervalIndexes']['location']:
        counter = 0
        for i in db[label]['intervalIndexes']['location'][loc].iterOverlap(begin, end):
            # first is timetamp, second is counter, third is total utilization at timestamp
            sul.setIntervalAtLocation({'index':i.begin, 'counter': 1, 'util': None}, loc)
            sul.setIntervalAtLocation({'index':i.end, 'counter': -1, 'util': None}, loc)

        sul.sortAtLoc(loc)

        for criticalPt in sul[loc]:
            counter += criticalPt['counter']
            criticalPt['counter'] = counter
            criticalPt['util'] = sul.calcCurrentUtil(loc, criticalPt['index'])

    db[label]['sparseUtilizationList'] = sul




    pass

class SparseUtilizationList():
    def __init__(self, locationDict={}):
        self.locationDict = locationDict

    def __getitem__(self, loc):
        return self.locationDict[loc]

    def sortAtLoc(self, loc):
        self.locationDict[loc].sort(key=lambda x: x['index'])

    def calcCurrentUtil(self, location, index):
        if location not in self.locationDict:
            last = 0
        elif len(self.locationDict[location]) is 0:
            last = 0
        else:
            last = self.locationDict[location][len(self.locationDict[location])-1]
        return ((i.begin - last['index']) * last['counter'])

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
        pass
