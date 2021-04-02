from . import logToConsole

def processCode(self, datasetId, name, codeLines, codeType):
    assert codeType in ['physl', 'python', 'cpp']
    self.addSourceFile(datasetId, name, codeType)
    self[datasetId][codeType] = '\n'.join(codeLines)
    self.finishLoadingSourceFile(datasetId, name)

async def processCodeFile(self, datasetId, file, codeType, log=logToConsole):
    self.processCode(datasetId, file.name, file.read().splitlines(), codeType)
    await log('Finished parsing %s code' % codeType)
