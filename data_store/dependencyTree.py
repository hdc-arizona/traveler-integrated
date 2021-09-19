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

    def mergeChildren(self):
        flag = [False] * len(self.children)
        compactList = list()
        for ind, child in enumerate(self.children):
            if flag[ind] is True:
                continue
            flag[ind] = True
            compactList.append(child)
            for otherInd, otherChild in enumerate(self.children[ind+1:], start=ind+1):
                if otherChild.name == child.name:
                    flag[otherInd] = True
                    child.resetChildrenList(child.children + otherChild.children)
                    new_prefixes = list()
                    for pre in otherChild.prefixList:
                        if pre not in child.prefixList:
                            new_prefixes.append(pre)
                    child.mergeChildren()
                    child.addPrefixList(new_prefixes)
        self.resetChildrenList(compactList)