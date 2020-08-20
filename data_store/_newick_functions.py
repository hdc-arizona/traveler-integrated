import re
import newick
from .loggers import logToConsole

# Tools for handling the tree
treeModeParser = re.compile(r'Tree information for function:')
unflaggedTreeParser = re.compile(r'\(\(\(\(\(.*;')  # assume a line beginning with at least 5 parens is the tree

def processNewickNode(self, label, node):
    # Create the hashed primitive object
    primitiveName = node.name.strip()
    newR = self.processPrimitive(label, primitiveName, 'newick')[1]
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
                childTree, nr, sr, nl, sl = self.processNewickNode(label, child)
                tree['children'].append(childTree)
                newR += nr
                seenR += sr
                l = self.addPrimitiveChild(label, primitiveName, childTree['name'], 'newick')[1]
                newL += nl + l
                seenL += sl + (1 if l == 0 else 0)
    handleChildren(node.descendants)
    return (tree, newR, seenR, newL, seenL)

async def processNewickTree(self, label, newickText, log=logToConsole):
    tree, newR, seenR, newL, seenL = self.processNewickNode(label, newick.loads(newickText)[0])
    self.addTree(label, tree, 'newick')
    await log('Finished parsing newick tree')
    await log('New primitives: %d, Observed existing primitives: %d' % (newR, seenR))
    await log('New links: %d, Observed existing links: %d' % (newL, seenL))
    return (newR, seenR, newL, seenL)

async def processNewickFile(self, label, file, log=logToConsole):
    self.addSourceFile(label, file.name, 'newick')
    await self.processNewickTree(label, file.read(), log)
    self.finishLoadingSourceFile(label, file.name)
