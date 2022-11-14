import os
import sys
import shutil
import pickle
import errno
import uuid
from copy import deepcopy
import diskcache

# Possible files / metadata structures that we create / open / update
diskCacheIndices = ['info', 'primitives', 'primitiveLinks', 'intervals', 'guids', 'events', 'procMetrics']
requiredDiskCacheIndices = ['info', 'primitives', 'primitiveLinks']
pickles = ['trees', 'physl', 'python', 'cpp', 'sparseUtilizationList', 'intervalIndex', 'dependencyTree']
requiredPickleDicts = ['trees']
defaultInfo = {
    'sourceFiles': [],
    'tags': {},
    'colors': 'Red',
    'label': 'Untitled dataset'
}

async def logToConsole(value, end='\n'):
    sys.stdout.write('\x1b[0;32;40m' + value + end + '\x1b[0m')
    sys.stdout.flush()

class DataStore:
    def __init__(self, dbDir='/tmp/traveler-integrated', debugSources=False):
        self.dbDir = dbDir
        self.debugSources = debugSources
        if not os.path.exists(self.dbDir):
            os.makedirs(self.dbDir)

        self.datasets = {}

    async def load(self, log=logToConsole):
        # Load any files that exist (or create missing required files)
        for datasetId in os.listdir(self.dbDir):
            self.datasets[datasetId] = {}
            idDir = os.path.join(self.dbDir, datasetId)
            for ctype in diskCacheIndices:
                cpath = os.path.join(idDir, ctype + '.diskCacheIndex')
                if os.path.exists(cpath):
                    await log('Loading %s %s...' % (datasetId, ctype))
                    self[datasetId][ctype] = diskcache.Index(cpath)
                elif ctype in requiredDiskCacheIndices:
                    raise FileNotFoundError(errno.ENOENT, os.strerror(errno.ENOENT), cpath)
            for ptype in pickles:
                ppath = os.path.join(idDir, ptype + '.pickle')
                if os.path.exists(ppath):
                    await log('Loading %s %s...' % (datasetId, ptype))
                    self[datasetId][ptype] = pickle.load(open(ppath, 'rb'))
                elif ptype in requiredPickleDicts:
                    raise FileNotFoundError(errno.ENOENT, os.strerror(errno.ENOENT), ppath)
            for key, defaultValue in defaultInfo.items():
                self[datasetId]['info'][key] = self[datasetId]['info'].get(key, deepcopy(defaultValue))
            self[datasetId]['info']['datasetId'] = datasetId
            await log('Finished loading %s (%s)' % (datasetId, self[datasetId]['info']['label']))

    def __getitem__(self, datasetId):
        return self.datasets[datasetId]

    def __contains__(self, datasetId):
        return datasetId in self.datasets

    def __delitem__(self, datasetId):
        del self.datasets[datasetId]
        idDir = os.path.join(self.dbDir, datasetId)
        if os.path.exists(idDir):
            shutil.rmtree(idDir)

    def __iter__(self):
        yield from self.datasets.values()

    def generateUniqueDatasetId(self):
        datasetId = None
        while datasetId is None or datasetId in self:
            datasetId = str(uuid.uuid4())
        return datasetId

    def createDataset(self):
        datasetId = self.generateUniqueDatasetId()
        idDir = os.path.join(self.dbDir, datasetId)
        if datasetId in self or os.path.exists(idDir):
            del self[datasetId]
        self.datasets[datasetId] = {}
        os.makedirs(idDir)
        for ctype in requiredDiskCacheIndices:
            cpath = os.path.join(idDir, ctype + '.diskCacheIndex')
            self[datasetId][ctype] = diskcache.Index(cpath)
        for ptype in requiredPickleDicts:
            self[datasetId][ptype] = {}
        for key, defaultValue in defaultInfo.items():
            self[datasetId]['info'][key] = self[datasetId]['info'].get(key, deepcopy(defaultValue))
        self[datasetId]['info']['datasetId'] = datasetId
        return self[datasetId]

    def addSourceFile(self, datasetId, fileName, fileType):
        # Have to do this separately because info is a diskcache
        sourceFiles = self[datasetId]['info']['sourceFiles']
        sourceFiles.append({'fileName': fileName, 'fileType': fileType, 'stillLoading': True})
        self[datasetId]['info']['sourceFiles'] = sourceFiles

    def finishLoadingSourceFile(self, datasetId, fileName):
        sourceFiles = self[datasetId]['info']['sourceFiles']
        sourceFile = next((f for f in sourceFiles if f['fileName'] == fileName), None)
        if sourceFile is not None:
            sourceFile['stillLoading'] = False
        else:
            raise Exception("Can't finish unknown source file: " + fileName)
        # Tell the diskcache that something has been updated
        self[datasetId]['info']['sourceFiles'] = sourceFiles

    def rename(self, datasetId, newLabel):
        # Remove any leading or trailing slashes or spaces
        newLabel = newLabel.strip('/ ')
        if len(newLabel) == 0:
            newLabel = defaultInfo['label']
        self[datasetId]['info']['label'] = newLabel
        
    # appends set of colors to existing colors
    def addColors(self, datasetId, colors):
        existingColors = self[datasetId]['info']['colors']
        existingColors.update(colors)
        self[datasetId]['info']['colors'] = existingColors
    
    # overrides existing colors with new set of colors
    def setColors(self, datasetId, colors):
        self[datasetId]['info']['colors'] = colors

    def addTags(self, datasetId, tags):
        existingTags = self[datasetId]['info']['tags']
        existingTags.update(tags)
        self[datasetId]['info']['tags'] = existingTags

    def setTags(self, datasetId, tags):
        self[datasetId]['info']['tags'] = tags

    def addTagToAllDatasets(self, tag):
        for dataset in self:
            # Have to split this up to tell the diskcache that something has
            # been updated
            temp = dataset['info']['tags']
            temp[tag] = True
            dataset['info']['tags'] = temp

    def addTree(self, datasetId, tree, sourceType):
        self[datasetId]['trees'][sourceType] = tree

    async def save(self, datasetId, log=logToConsole):
        idDir = os.path.join(self.dbDir, datasetId)
        for ctype in self[datasetId].keys():
            if ctype in diskCacheIndices:
                await log('Saving %s diskCache.Index: %s' % (datasetId, ctype))
                self[datasetId][ctype].cache.close()
            if ctype in pickles:
                await log('Saving %s pickle: %s' % (datasetId, ctype))
                with open(os.path.join(idDir, ctype + '.pickle'), 'wb') as pickleFile:
                    pickle.dump(self[datasetId][ctype], pickleFile)

    def processPrimitive(self, datasetId, primitiveName, source=None):
        primitives = self[datasetId]['primitives']
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
                # tell the primitives diskcache that there was an update
                primitives[primitiveName] = primitive
            return (primitive, 0)
        primitiveChunks = primitiveName.split('$')
        primitive['name'] = primitiveChunks[0]
        if len(primitiveChunks) >= 3:
            primitive['line'] = primitiveChunks[-2]
            primitive['char'] = primitiveChunks[-1]
        primitives[primitiveName] = primitive
        return (primitive, 1)

    def addPrimitiveChild(self, datasetId, parent, child, source=None):
        primitives = self[datasetId]['primitives']
        assert parent in primitives and child in primitives
        parentPrimitive = primitives[parent]
        childPrimitive = primitives[child]
        primitiveLinks = self[datasetId]['primitiveLinks']
        if child not in parentPrimitive['children']:
            parentPrimitive['children'].append(child)
            # tell the primitives diskcache that there was an update
            primitives[parent] = parentPrimitive
        if parent not in childPrimitive['parents']:
            childPrimitive['parents'].append(parent)
            # tell the primitives diskcache that there was an update
            primitives[child] = childPrimitive

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
                # tell the primitiveLinks diskcache that there was an update
                primitiveLinks[linkId] = link
            return (link, 0)
        primitiveLinks[linkId] = link
        return (link, 1)

    # pylint: disable=C0415
    from ._newick_functions import processNewickTree, processNewickNode, processNewickFile
    from ._dot_functions import processDotLine, processDot, processDotFile
    from ._csv_functions import processCsvLine, processCsv, processCsvFile
    from ._code_functions import processCode, processCodeFile
    from ._log_functions import processPhylanxLog, processPhylanxLogFile
    from ._otf2_functions import processEvent, processOtf2, processRawTrace, combineIntervals, buildIntervalTree, connectIntervals, buildSparseUtilizationLists, buildDependencyTree
