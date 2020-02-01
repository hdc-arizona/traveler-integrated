import os
import shutil
import pickle
import errno
import diskcache #pylint: disable=import-error
from .loggers import logToConsole, ClientLogger

# Possible files / metadata structures that we create / open / update
diskCacheIndices = ['meta', 'primitives', 'primitiveLinks', 'intervals', 'guids', 'events', 'procMetrics']
requiredDiskCacheIndices = ['meta', 'primitives', 'primitiveLinks']
pickles = ['intervalIndexes', 'trees', 'physl', 'python', 'cpp']
requiredMetaLists = ['sourceFiles']
requiredPickleDicts = ['trees']

class DataStore:
    def __init__(self, dbDir='/tmp/traveler-integrated', debugSources=False):
        self.dbDir = dbDir
        self.debugSources = debugSources
        self.sortedEventsByLocation = None
        if not os.path.exists(self.dbDir):
            os.makedirs(self.dbDir)

        self.datasets = {}

    async def load(self, log=logToConsole):
        # Load any files that exist (or create missing required files)
        for label in os.listdir(self.dbDir):
            self.datasets[label] = {}
            labelDir = os.path.join(self.dbDir, label)
            for ctype in diskCacheIndices:
                cpath = os.path.join(labelDir, ctype + '.diskCacheIndex')
                if os.path.exists(cpath):
                    await log('Loading %s %s...' % (label, ctype))
                    self.datasets[label][ctype] = diskcache.Index(cpath)
                elif ctype in requiredDiskCacheIndices:
                    raise FileNotFoundError(errno.ENOENT, os.strerror(errno.ENOENT), cpath)
            for ptype in pickles:
                ppath = os.path.join(labelDir, ptype + '.pickle')
                if os.path.exists(ppath):
                    await log('Loading %s %s...' % (label, ptype))
                    if ptype == 'intervalIndexes':
                        await log('(may take a while if %s is large)' % label)
                    self.datasets[label][ptype] = pickle.load(open(ppath, 'rb'))
                elif ptype in requiredPickleDicts:
                    raise FileNotFoundError(errno.ENOENT, os.strerror(errno.ENOENT), ppath)
            for listType in requiredMetaLists:
                self.datasets[label]['meta'][listType] = self.datasets[label]['meta'].get(listType, [])

    def datasetList(self):
        return list(self.datasets.keys())

    def __getitem__(self, label):
        return self.datasets[label]

    def __contains__(self, label):
        return label in self.datasets

    def createDataset(self, label):
        labelDir = os.path.join(self.dbDir, label)
        if label in self.datasets or os.path.exists(labelDir):
            self.purgeDataset(label)
        self.datasets[label] = {}
        os.makedirs(labelDir)
        for ctype in requiredDiskCacheIndices:
            cpath = os.path.join(labelDir, ctype + '.diskCacheIndex')
            self.datasets[label][ctype] = diskcache.Index(cpath)
        for ptype in requiredPickleDicts:
            self.datasets[label][ptype] = {}
        for listType in requiredMetaLists:
            self.datasets[label]['meta'][listType] = self.datasets[label]['meta'].get(listType, [])

    def purgeDataset(self, label):
        del self.datasets[label]
        labelDir = os.path.join(self.dbDir, label)
        if os.path.exists(labelDir):
            shutil.rmtree(labelDir)

    def addSourceFile(self, label, fileName, fileType):
        # Have to do this separately because meta is a diskcache
        sourceFiles = self.datasets[label]['meta']['sourceFiles']
        sourceFiles.append({'fileName': fileName, 'fileType': fileType})
        self.datasets[label]['meta']['sourceFiles'] = sourceFiles

    def addTree(self, label, tree, sourceType):
        self.datasets[label]['trees'][sourceType] = tree

    async def save(self, label, log=logToConsole):
        labelDir = os.path.join(self.dbDir, label)
        for ctype in self.datasets[label].keys():
            if ctype in diskCacheIndices:
                await log('Saving %s diskCache.Index: %s' % (label, ctype))
                self.datasets[label][ctype].cache.close()
            if ctype in pickles:
                await log('Saving %s pickle: %s' % (label, ctype))
                with open(os.path.join(labelDir, ctype + '.pickle'), 'wb') as pickleFile:
                    pickle.dump(self.datasets[label][ctype], pickleFile)

    def processPrimitive(self, label, primitiveName, source=None):
        primitives = self.datasets[label]['primitives']
        primitive = primitives.get(primitiveName, {'parents': [], 'children': []})
        updatedSources = False
        if self.debugSources:
            primitive['sources'] = primitive.get('sources', [])
            if source is not None and source not in primitive['sources']:
                primitive['sources'].append(source)
                updatedSources = True
        if primitiveName in primitives:
            # Already existed
            if updatedSources:
                primitives[primitiveName] = primitive # tells the primitives diskcache that there was an update
            return (primitive, 0)
        primitiveChunks = primitiveName.split('$')
        primitive['name'] = primitiveChunks[0]
        if len(primitiveChunks) >= 3:
            primitive['line'] = primitiveChunks[-2]
            primitive['char'] = primitiveChunks[-1]
        primitives[primitiveName] = primitive
        return (primitive, 1)

    def addPrimitiveChild(self, label, parent, child, source=None):
        primitives = self.datasets[label]['primitives']
        assert parent in primitives and child in primitives
        parentPrimitive = primitives[parent]
        childPrimitive = primitives[child]
        primitiveLinks = self.datasets[label]['primitiveLinks']
        if child not in parentPrimitive['children']:
            parentPrimitive['children'].append(child)
            primitives[parent] = parentPrimitive # tells the primitives diskcache that there was an update
        if parent not in childPrimitive['parents']:
            childPrimitive['parents'].append(parent)
            primitives[child] = childPrimitive # tells the primitives diskcache that there was an update

        linkId = parent + '_' + child
        link = primitiveLinks.get(linkId, {'parent': parent, 'child': child})
        updatedSources = False
        if self.debugSources:
            link['sources'] = link.get('sources', [])
            if source is not None and source not in link['sources']:
                link['sources'].append(source)
                updatedSources = True
        if linkId in primitiveLinks:
            # Already existed
            if updatedSources:
                primitiveLinks[linkId] = link # tells the primitiveLinks diskcache that there was an update
            return (link, 0)
        primitiveLinks[linkId] = link
        return (link, 1)

    from ._newickFunctions import processNewickTree, processNewickNode, processNewickFile
    from ._dotFunctions import processDotLine, processDot, processDotFile
    from ._csvFunctions import processCsvLine, processCsv, processCsvFile
    from ._codeFunctions import processCode, processCodeFile
    from ._logFunctions import processPhylanxLog, processPhylanxLogFile
    from ._otf2Functions import processEvent, processOtf2
