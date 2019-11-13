import html
from IPython.core.display import HTML, display

def visualizeInTraveler(fun):
    template = '''
        <div>Debugging __perfdata__</div>
        <div>%s</div>
        <div>%s</div>
        <div>%s</div>
        <div>%s</div>
        <a href="https://localhost:8000">Visualize performance data</a>
    ''' % ( \
        html.escape(fun.__perfdata__[0]), \
        html.escape(fun.__perfdata__[1]), \
        html.escape(fun.__perfdata__[2]), \
        html.escape(fun.__src__))
    display(HTML(template))
