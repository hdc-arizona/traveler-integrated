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
        return thisNode
