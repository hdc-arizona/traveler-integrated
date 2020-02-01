from .loggers import logToConsole

def processCode(self, label, name, codeLines, codeType):
    assert codeType in ['physl', 'python', 'cpp']
    self.addSourceFile(label, name, codeType)
    self.datasets[label][codeType] = '\n'.join(codeLines)

async def processCodeFile(self, label, file, codeType, log=logToConsole):
    self.processCode(label, file.name, file.read().splitlines(), codeType)
    await log('Finished parsing %s code' % codeType)
