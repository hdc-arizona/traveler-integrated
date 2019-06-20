import os
import shelve
import pickle
import sys

def log(value, end='\n'):
    sys.stderr.write('\x1b[0;32;40m' + value + end + '\x1b[0m')
    sys.stderr.flush()

required_shelves = ['meta', 'primitives', 'primitiveLinks']
required_pickles = []
optional_shelves = ['intervals', 'guids', 'events']
optional_pickles = ['coreTree', 'intervalIndex', 'code']

def loadDatabase(dbDir):
    db = {}

    if not os.path.exists(dbDir):
        os.makedirs(dbDir)

    for label in os.listdir(dbDir):
        db[label] = {}
        labelDir = os.path.join(dbDir, label)
        for stype in required_shelves:
            log('Loading %s %s...' % (label, stype))
            db[label][stype] = shelve.open(os.path.join(labelDir, stype + '.shelf'))
        for stype in required_pickles:
            log('Loading %s %s...' % (label, stype))
            db[label][stype] = pickle.load(open(os.path.join(labelDir, stype + '.pickle')))
        for stype in optional_shelves:
            log('Loading %s %s...' % (label, stype))
            spath = os.path.join(labelDir, stype + '.shelf')
            if os.path.exists(spath + '.db'): # shelves auto-add .db to their filenames
                db[label][stype] = shelve.open(spath)
        for stype in optional_pickles:
            log('Loading %s %s...' % (label, stype))
            if stype == 'intervalIndex':
                log('(may take a while if %s is large)' % label)
            spath = os.path.join(labelDir, stype + '.pickle')
            if os.path.exists(spath):
                db[label][stype] = pickle.load(open(spath, 'rb'))

    return db

def addPrimitiveChild(parent, child, primitives=None, primitiveLinks=None, source=None, debug=False):
    parentPrimitive = primitives.get(parent, None)
    childPrimitive = primitives.get(child, None)
    assert parentPrimitive is not None and childPrimitive is not None
    if child not in parentPrimitive['children']:
        parentPrimitive['children'].append(child)
        primitives[parent] = parentPrimitive
        if 'time' in child:
            primitives[parent]['childrenTime'] += child['time']
    if parent not in childPrimitive['parents']:
        childPrimitive['parents'].append(parent)
        primitives[child] = childPrimitive

    linkId = parent + '_' + child
    if linkId in primitiveLinks:
        link = primitiveLinks[linkId]
        if debug is True and source is not None and source not in link['sources']:
            link['sources'].append(source)
        primitiveLinks[linkId] = link
        return (link, 0)
    link = {
        'parent': parent,
        'child': child
    }
    if debug is True:
        link['sources'] = [source]
    primitiveLinks[linkId] = link
    return (link, 1)

def processPrimitive(primitiveName, primitives=None, source=None, debug=False):
    primitive = primitives.get(primitiveName, None)
    if primitive is not None:
        if debug is True and source is not None and source not in primitive['sources']:
            primitive['sources'].append(source)
            primitives[primitiveName] = primitive
        return (primitive, 0)
    primitive = {'parents': [], 'children': [], 'childrenTime': 0}
    if debug is True:
        primitive['sources'] = [source]
    primitiveChunks = primitiveName.split('$')
    primitive['name'] = primitiveChunks[0]
    if len(primitiveChunks) >= 3:
        primitive['line'] = primitiveChunks[-2]
        primitive['char'] = primitiveChunks[-1]
    primitives[primitiveName] = primitive
    return (primitive, 1)
