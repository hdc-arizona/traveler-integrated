import requests
from IPython.core.display import display
from TwoWayWebView import TwoWayWebView

def visualizeInTraveler(fun):
    widget = TwoWayWebView(filename='uploadWidget.html')
    display(widget)
    return widget
    '''
    with open('uploadTemplate.html' as
        html.escape(fun.__perfdata__[0]), \
        html.escape(fun.__perfdata__[1]), \
        html.escape(fun.__perfdata__[2]), \
        html.escape(fun.__src__))
    display(HTML(template))
    '''
