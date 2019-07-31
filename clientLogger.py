import asyncio

class ClientLogger:
    def __init__(self):
        self.message = ''
        self.finished = False

    async def log(self, value, end='\n'):
        self.message += value + end
        await asyncio.sleep(1)

    def finish(self):
        self.finished = True

    async def iterate(self, startProcess):
        await startProcess()
        while not self.finished:
            yield self.message
            self.message = ''
            await asyncio.sleep(1)
