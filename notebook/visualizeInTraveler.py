import inspect
from datetime import datetime
from urllib.parse import quote_plus
import requests
from IPython.core.display import display
from TwoWayWebView import TwoWayWebView

def visualizeInTraveler(fun):
    widget = TwoWayWebView(filename='uploadWidget.html')
    display(widget)

    label = 'Jupyter@' + datetime.now().isoformat()
    response = requests.post('http://localhost:8000/datasets/%s' % quote_plus(label), json={
        'csv': fun.__perfdata__[0],
        'newick': fun.__perfdata__[1],
        'dot': fun.__perfdata__[2],
        'physl': fun.__src__,
        'python': inspect.getsource(fun.backend.wrapped_function)
    })
    return response
