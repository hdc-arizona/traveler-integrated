import json
from IPython import get_ipython
from IPython.core.display import HTML

nextPyInstanceId = 0
wrapperTemplate = '''
    <div data-py-instance-id="%i" data-js-rendered-id="%i">
        <script type="application/javascript">
            window.__currentContainer = document.querySelector('[data-py-instance-id="%i"][data-js-rendered-id="%i"]');
        </script>
        %s
        <script type="application/javascript">
            window.__currentContainer.sendObject = function (obj) {
                // TODO: figure out how to identify twoWayInstance
                throw new Error('unimplemented');
                IPython.notebook.kernel.execute(`twoWayInstance._receiveObject(${JSON.stringify(obj)})`);
            };
        </script>
    </div>
'''
finderTemplate = '''
    const container = document.querySelector('[data-py-instance-id="%i"][data-js-rendered-id="%i"]');
    console.log('firing finder', container, container.receiveObject);
    if (container && container.receiveObject) {
        container.receiveObject(%s);
    }
'''

class TwoWayWebView(HTML):
    def __init__(self, *args, **kwargs):
        global nextPyInstanceId
        self._pyInstanceId = nextPyInstanceId
        nextPyInstanceId += 1

        self._numJsRenders = 0
        super(TwoWayWebView, self).__init__(*args, **kwargs)

    def _repr_html_(self):
        data = super(TwoWayWebView, self)._repr_html_()
        data = wrapperTemplate % (self._pyInstanceId, self._numJsRenders, self._pyInstanceId, self._numJsRenders, data)
        self._numJsRenders += 1
        return data

    def sendObject(self, obj):
        ipython = get_ipython()
        for jsRenderedId in range(self._numJsRenders):
            js = finderTemplate % (self._pyInstanceId, jsRenderedId, json.dumps(obj))
            ipython.run_cell_magic('javascript', '', js)

    def _receiveObject(self, jsonString):
        self.receiveObject(json.loads(jsonString))

    def receiveObject(self, obj):
        pass
