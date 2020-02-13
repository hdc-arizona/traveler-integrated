#!/usr/bin/env python3
import json

import requests
import argparse

# cmdline args
parser = argparse.ArgumentParser(description='Make our profiling tool fancy.')
parser.add_argument('-n', '--number-trials', dest='n_trials', default=100,
                    help='The number of trials which are profiled and averaged over. Default 100.')
parser.add_argument('-e', '--endpoint', dest='end_pt', default='http://127.0.0.1:8000',
                    help='The base adress of our endpoint we are querying to. Default localhost:8000')
parser.add_argument('-b', '--begin', dest='begin', default=None,
                    help='Beginning of the range of values to be queried by histogram or interval call.')
parser.add_argument('-en', '--end', dest='end', default=None,
                    help='End of the range of values to be queried by histogram or interval call.')
parser.add_argument('-bn', '--bins', dest='bins', default=None,
                    help='Total number of bins.')
parser.add_argument('-d', '--datset', dest='dataset_label', default=None,
                    help = 'The name of the dataset we are querying from.')
parser.add_argument('-s', '--sort_order', dest='sort_order', default='cumulative',
                    help='This is the sort order of the profile output')
parser.add_argument('-o', '--output', dest='prof_output', default="_.txt",
                    help='This is the filename of the output produced by the profile run.')
parser.add_argument('-i', '--input', dest="spec_file", default=None,
                    help="This argument gives the filename of a configuration file which is open and read. The configuration file is .json format.")

def main():
    args = vars(parser.parse_args())
    with open(args['spec_file']) as json_file:
        data = json.load(json_file)
        n_trials = data["n_trials"]
        endpt = data["end_pt"]
        begin = data["begin"]
        end = data["end"]
        bins = data["bins"]
        dataset_label = data["dataset_label"]
        sort_order = data["sort_order"]
        prof_output = data["prof_output"]

    # call profile start endpoint
    requests.get(endpt+'/profile/start')

    requestString = endpt + '/profile/datasets/' + dataset_label + '/drawValues/' + str(bins) + '/' + str(begin) + '/' + str(end)
    # loop over number of runs
    for n in range(0, n_trials):
        requests.get(requestString)

    # call profile print endpoint
    requests.get(endpt+'/profile/print/' + sort_order + '/' + prof_output + '/{}'.format(n))


main()
