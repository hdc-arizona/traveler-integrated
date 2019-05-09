import os
import shelve
import sys

def log(value, end='\n'):
    sys.stderr.write('\x1b[0;32;40m' + value + end + '\x1b[0m')
    sys.stderr.flush()

required_shelves = ['meta', 'regions', 'regionLinks']
optional_shelves = ['ranges', 'guids', 'events']

def loadDatabase(dbDir):
    db = {}

    if not os.path.exists(dbDir):
        os.makedirs(dbDir)

    for label in os.listdir(dbDir):
        db[label] = {}
        labelDir = os.path.join(dbDir, label)
        for stype in required_shelves:
            db[label][stype] = shelve.open(os.path.join(labelDir, stype + '.shelf'))
        for stype in optional_shelves:
            spath = os.path.join(labelDir, stype + '.shelf')
            if os.path.exists(spath):
                db[label][stype] = shelve.open(spath)

    return db

def addRegionChild(parent, child, regions=None, regionLinks=None, source=None, debug=False):
    parentRegion = regions.get(parent, None)
    childRegion = regions.get(child, None)
    assert parentRegion is not None and childRegion is not None
    if child not in parentRegion['children']:
        parentRegion['children'].append(child)
        regions[parent] = parentRegion
        if 'time' in child:
            regions[parent]['childrenTime'] += child['time']
    if parent not in childRegion['parents']:
        childRegion['parents'].append(parent)
        regions[child] = childRegion

    linkId = parent + '_' + child
    if linkId in regionLinks:
        link = regionLinks[linkId]
        if debug is True and source is not None and source not in link['sources']:
            link['sources'].append(source)
        regionLinks[linkId] = link
        return (link, 0)
    link = {
        'parent': parent,
        'child': child
    }
    if debug is True:
        link['sources'] = [source]
    regionLinks[linkId] = link
    return (link, 1)

def processRegion(regionName, regions=None, source=None, debug=False):
    region = regions.get(regionName, None)
    if region is not None:
        if debug is True and source is not None and source not in region['sources']:
            region['sources'].append(source)
            regions[regionName] = region
        return (region, 0)
    region = {'parents': [], 'children': [], 'childrenTime': 0}
    if debug is True:
        region['sources'] = [source]
    regionChunks = regionName.split('$')
    region['name'] = regionChunks[0]
    if len(regionChunks) >= 3:
        region['line'] = regionChunks[-2]
        region['char'] = regionChunks[-1]
    regions[regionName] = region
    return (region, 1)
