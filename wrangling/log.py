import sys

def log(value, end='\n'):
    sys.stderr.write('\x1b[0;32;40m' + value + end + '\x1b[0m')
    sys.stderr.flush()