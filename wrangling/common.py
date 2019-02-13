def addRegionChild(regions, regionLinks, parent, child, source, debug=False):
    parentRegion = regions.find_one({'_id': parent})
    childRegion = regions.find_one({'_id': child})
    assert parentRegion is not None and childRegion is not None
    if child not in parentRegion['children']:
        parentRegion['children'].append(child)
        regions.replace_one({'_id': parent}, parentRegion)
    if parent not in childRegion['parents']:
        childRegion['parents'].append(parent)
        regions.replace_one({'_id': child}, childRegion)

    linkId = parent + '_' + child
    link = regionLinks.find_one({'_id': linkId})
    if link is None:
        link = {
            '_id': linkId,
            'parent': parent,
            'child': child
        }
        if debug is True:
            link['sources'] = [source]
    if debug is True and source not in link['sources']:
        link['sources'].append(source)
    regionLinks.replace_one({'_id': linkId}, link)

def processRegion(regions, regionName, source, debug=False):
    region = regions.find_one({'_id': regionName})
    if region is not None:
        if debug is True and source not in region['sources']:
            region['sources'].append(source)
            regions.replace_one({'_id': regionName}, region)
        return region
    region = { '_id': regionName, 'parents': [], 'children': [] }
    if debug is True:
        region['sources'] = [source]
    regionChunks = regionName.split('$')
    region['name'] = regionChunks[0]
    if len(regionChunks) >= 3:
        region['line'] = regionChunks[-2]
        region['char'] = regionChunks[-1]
    regions.insert_one(region)
    return region