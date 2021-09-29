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
def traceForwardIntervals(label: str, begin: float = None, end: float = None):
    prf.start()
    primitive_trace_forward(label, '592a4ef3-eace-4a86-bb6b-e84407882d99')
    prf.end()


    return 0



@router.get('/profile/print/{sortby}/{filename}/{numberOfRuns}')
def profilePrint(sortby: str, filename: str, numberOfRuns: int):
    prf.dumpAverageStats(sortby, filename, numberOfRuns)
