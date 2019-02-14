def addRegionChild(regions, regionLinks, parent, child, source, debug=False):
    parentRegion = regions.get(parent, None)
    childRegion = regions.get(child, None)
    assert parentRegion is not None and childRegion is not None
    if child not in parentRegion['children']:
        parentRegion['children'].append(child)
        regions[parent] = parentRegion
    if parent not in childRegion['parents']:
        childRegion['parents'].append(parent)
        regions[child] = childRegion

    linkId = parent + '_' + child
    link = regionLinks.get(linkId, None)
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
    regionLinks[linkId] = link

def processRegion(regions, regionName, source, debug=False):
    region = regions.get(regionName, None)
    if region is not None:
        if debug is True and source not in region['sources']:
            region['sources'].append(source)
            regions[regionName] = region
        return region
    region = { 'parents': [], 'children': [] }
    if debug is True:
        region['sources'] = [source]
    regionChunks = regionName.split('$')
    region['name'] = regionChunks[0]
    if len(regionChunks) >= 3:
        region['line'] = regionChunks[-2]
        region['char'] = regionChunks[-1]
    regions[regionName] = region
    return region