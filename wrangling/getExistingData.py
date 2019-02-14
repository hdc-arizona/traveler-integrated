import os
import shelve

required_shelves = ['meta', 'regions', 'regionLinks']
optional_shelves = ['ranges', 'guids', 'events']

def getExistingData(dbDir):
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