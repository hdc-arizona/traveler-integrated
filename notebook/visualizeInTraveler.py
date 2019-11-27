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
    widget.sendObject({'datasetLabel': label})
    url = 'http://localhost:8000/datasets/%s' % quote_plus(label)
    response = requests.post(url, stream=True, json={
        'csv': fun.__perfdata__[0],
        'newick': fun.__perfdata__[1],
        'dot': fun.__perfdata__[2],
        'physl': fun.__src__,
        'python': inspect.getsource(fun.backend.wrapped_function)
    })
    for line in response.iter_lines(decode_unicode=True):
        widget.sendObject({'messageChunk': line})
    widget.sendObject({'done': True})
    return response
