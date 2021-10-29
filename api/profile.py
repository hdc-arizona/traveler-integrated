from fastapi import APIRouter

from profiling_tools.profilier import Profilier
from .intervals import get_intervals, primitive_trace_forward

router = APIRouter()

prf = Profilier()
profile = False

@router.get('/profile/start')
def profileStart():
    prf.reset()


@router.get('/profile/datasets/{label}/intervals')
def profileIntervals(label: str, begin: float = None, end: float = None):
    prf.start()
    get_intervals(label, begin, end, True)
    prf.end()

    return 0


@router.get('/profile/datasets/{label}/traceForward')
def traceForwardIntervals(label: str, bins: int = 100, begin: float = None, end: float = None):
    print('this is here')
    prf.start()
    primitive_trace_forward(label, '1b8b1b22-fdd7-4a63-b112-bea6fc7ed747', bins, None, None, '1,2,3,4,5,6,7,8,9,10', '1,2,3,4,5,6,7,8,9,10')
    prf.end()


    return 0



@router.get('/profile/print/{sortby}/{filename}/{numberOfRuns}')
def profilePrint(sortby: str, filename: str, numberOfRuns: int):
    prf.dumpAverageStats(sortby, filename, numberOfRuns)
