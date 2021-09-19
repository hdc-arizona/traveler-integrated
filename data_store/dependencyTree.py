from .sparseUtilizationList import SparseUtilizationList


def get_primitive_pretty_name_with_prefix(primitive: str):
    delimiter = '/'
    start = primitive.find(delimiter)
    start = primitive.find(delimiter, start+len(delimiter))
    return primitive[:start+1], primitive[start+1:]


class DependencyTreeNode():
    def __init__(self):
        self.name = 'phylanx'
        self.children = list()  # list of DependencyTreeNode
        self.prefixList = list()  # list of string
        self.aggregatedBlockList = list()  # list of dictionary (start time, end time), convert it to (event, time) list later
        self.intervalList = list()  # containing just the enter and leave time of this interval, helper for creating aggreatedBlockList
        self.utilization = SparseUtilizationList()

    def setName(self, primitiveName):
        pref, self.name = get_primitive_pretty_name_with_prefix(primitiveName)
        self.prefixList.append(pref)

    def addChildren(self, child):
        notFound = True
        for myChild in self.children:
            if myChild.name == child.name:
                notFound = False
                # update the children
                for otherSubChild in child.children:
                    myChild.addChildren(otherSubChild)
                # update prefixList
                for pre in child.prefixList:
                    if pre not in myChild.prefixList:
                        myChild.prefixList.append(pre)
                # update aggregatedBlockList
                myChild.aggregatedBlockList.extend(child.aggregatedBlockList)
                myChild.intervalList.extend(child.intervalList)
                break

        if notFound:
            self.children.append(child)

    def addChildrenList(self, childrenList):
        self.children.extend(childrenList)

    def resetChildrenList(self, childrenList):
        self.children.clear()
        self.children = childrenList

    def addPrefixList(self, pl):
        self.prefixList.extend(pl)

    def getTheTree(self):
        thisNode = dict()
        thisNode['name'] = self.name
        thisNode['prefixList'] = self.prefixList
        cList = list()
        for child in self.children:
            cList.append(child.getTheTree())
        thisNode['children'] = cList
        thisNode['aggregatedList'] = self.aggregatedBlockList
        thisNode['intervalList'] = self.intervalList
        return thisNode

    def addIntervalToIntervalList(self, startTime, endTime):
        self.intervalList.append({'enter': startTime, 'leave': endTime})

    def updateAggregatedListFromIntervalList(self, startTime, endTime):
        self.intervalList.append({'enter': startTime, 'leave': endTime})
        self.aggregatedBlockList.append({'time': startTime, 'event': 'enter'})
        maxTime = endTime
        for eachChild in self.children:
            for eachAgg in eachChild.aggregatedBlockList:
                if eachAgg['event'] == 'leave':
                    maxTime = max(maxTime, eachAgg['time'])
        self.aggregatedBlockList.append({'time': maxTime, 'event': 'leave'})
