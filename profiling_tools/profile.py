import requests

# cmdline args maybe

def main():
    endpt = 'http://127.0.0.1:8000'

    # call profile start endpoint
    requests.get(endpt+'/profile/start')

    # loop over number of runs
    for n in range(0,100):
        requests.get(endpt+'/profile/datasets/FIB20/drawValues/800/14000000/250000000')

    # call profile print endpoint
    requests.get(endpt+'/profile/print/cumulative/test.prof/{}'.format(n))


main()
