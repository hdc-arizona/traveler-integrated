import re
import newick
from . import logToConsole

# Tools for handling the tree
treeModeParser = re.compile(r'Tree information for function:')
unflaggedTreeParser = re.compile(r'\(\(\(\(\(.*;')  # assume a line beginning with at least 5 parens is the tree

def processNewickNode(self, datasetId, node):
    # Create the hashed primitive object
    primitiveName = node.name.strip()
    newR = self.processPrimitive(datasetId, primitiveName, 'newick')[1]
    seenR = 1 if newR == 0 else 0
    tree = {'name': primitiveName, 'children': []}
    newL = seenL = 0

    # Create the tree hierarchy
    def handleChildren(childList):
        nonlocal newR, seenR, newL, seenL
        if not childList:
            return
        for child in childList:
            if child.name is None:
                # Skip nodes with no names, and connect to their children instead
                handleChildren(child.descendants)
            else:
                childTree, nr, sr, nl, sl = self.processNewickNode(datasetId, child)
                tree['children'].append(childTree)
                newR += nr
                seenR += sr
                l = self.addPrimitiveChild(datasetId, primitiveName, childTree['name'], 'newick')[1]
                newL += nl + l
                seenL += sl + (1 if l == 0 else 0)
    handleChildren(node.descendants)
    return (tree, newR, seenR, newL, seenL)

async def processNewickTree(self, datasetId, newickText, log=logToConsole):
    tree, newR, seenR, newL, seenL = self.processNewickNode(datasetId, newick.loads(newickText)[0])
    self.addTree(datasetId, tree, 'newick')
    await log('Finished parsing newick tree')
    await log('New primitives: %d, Observed existing primitives: %d' % (newR, seenR))
    await log('New links: %d, Observed existing links: %d' % (newL, seenL))
    return (newR, seenR, newL, seenL)

async def processNewickFile(self, datasetId, file, log=logToConsole):
    self.addSourceFile(datasetId, file.name, 'newick')
    await self.processNewickTree(datasetId, file.read(), log)
    self.finishLoadingSourceFile(datasetId, file.name)
