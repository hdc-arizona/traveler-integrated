import json
from IPython import get_ipython
from IPython.core.display import HTML

nextId = 0
wrapperTemplate = '''
    <div data-two-way-id="%i">
        %s
        <script type="application/javascript">
            document.currentScript.parentNode.sendObject = function (obj) {
                // TODO: figure out how to identify twoWayInstance
                throw new Error('unimplemented');
                IPython.notebook.kernel.execute(`twoWayInstance._recieveObject(${JSON.stringify(obj)})`);
            };
            document.__TwoWayLinks = document.__TwoWayLinks || [];
            document.__TwoWayLinks.push(function (jsonString) {
                if (document.currentScript &&
                    document.currentScript.parentNode
                    document.currentScript.parentNode.recieveObject) {
                    document.currentScript.parentNode.recieveObject(JSON.parse(jsonString));
                }
            });
        </script>
    </div>
'''

class TwoWayWebView(HTML):
    def __init__(self, *args, **kwargs):
        self._jsCallbackIds = []
        super(TwoWayWebView, self).__init__(*args, **kwargs)

    def _repr_html_(self):
        global nextId
        data = super(TwoWayWebView, self)._repr_html_()
        data = wrapperTemplate % (nextId, data)
        self._jsCallbackIds.append(nextId)
        nextId += 1
        return data

    def sendObject(self, obj):
        ipython = get_ipython()
        for callbackId in self._jsCallbackIds:
            js = 'window.__TwoWayLinks[%i](%s)' % (callbackId, json.dumps(obj))
            ipython.run_cell_magic('javascript', '', js)

    def _recieveObject(self, jsonString):
        self.recieveObject(json.loads(jsonString))

    def recieveObject(self, obj):
        pass
