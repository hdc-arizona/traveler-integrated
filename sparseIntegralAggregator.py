class SparseUtilizationList():
    def __init__(self):
        self.intervalIntegralList = []

    # In charge of loading interval data into our integral list
    # I have no idea how we want to load integral data :/
    def load(self, otf2File):
        pass

    # Calculates utilization histogram for all intervals regardless of location
    def calcUtilizationHistogram(self, bins=100, begin=None, end=None):
        pass

    # Calulates utilization for one location in a Gantt chart
    def calcUtilizationForLocation(self, bins=100, begin=None, end=None, Location=None):
        pass
