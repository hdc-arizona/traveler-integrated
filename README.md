traveler-integrated
===================

An integrated visualization system for parallel execution data, including OTF2 traces annd HPX execution trees

- [Basic setup](#basic-setup)
- [Collecting data via JetLag](#collecting-data-via-jetlag)
- [Development notes](#development-notes)

# Basic setup

## Prerequisites
### OTF2
If you plan to bundle otf2 traces,
[otf2](https://www.vi-hps.org/projects/score-p/) needs to be installed and its
binaries need to be in your `PATH`

### Python dependencies
```bash
python3 -m venv env
source env/bin/activate
pip3 install -r requirements.txt
```

### Building C dependencies
You will most likely need to build a C dependency for your specific
architecture:

```bash
cd profiling_tools/clibs
python3 rp_extension_build.py
mv _cCalcBin.*.so ../
rm _cCalcBin.* calcBin.o
```

## Workflow
Running traveler-integrated usually comes in two phases:
[bundling](#bundling-data), and [serving](#serving)

## Bundling data
Usually, you will need to run `bundle.py` to load data into traveler-integrated
from the command line. It's also possible to upload data in the interface
(except for OTF2 traces), and data can also be uploaded to a running `serve.py`
instance from [JetLag](#collecting-data-via-jetlag).

### Examples
Note that each of these examples, the data will be bundled into
`/tmp/travler-integrated`; if something goes wrong, `bundle.py` ***should***
behave reasonably idempotently, but if you just want to start with a fresh slate
anyway, try `rm -rf /tmp/traveler-integrated`.

A simple example bundling the full phylanx output and an OTF2 trace:
```bash
./bundle.py \
  --input data/als-30Jan2019/test_run/output.txt \
  --otf2 data/als-30Jan2019/test_run/OTF2_archive/APEX.otf2 \
  --label "2019-01-30 ALS Test Run"
```

Bunding just an OTF2 trace, as well as a source code file:
```bash
./bundle.py \
  --otf2 data/fibonacci-04Apr2018/OTF2_archive/APEX.otf2 \
  --python data/fibonacci-04Apr2018/fibonacci.py \
  --label "2019-04-04 Fibonacci"
```

Loading many files at once (using a regular expression to match globbed paths):
```bash
./bundle.py \
  --tree data/als_regression/*.txt \
  --performance data/als_regression/*.csv \
  --physl data/als_regression/als.physl \
  --cpp data/als_regression/als_csv_instrumented.cpp \
  --label "data/als_regression/(\d*-\d*-\d*).*"
```

Bringing it all together:
```bash
./bundle.py \
  --otf2 data/11July2019/factorial*/OTF2_archive/APEX.otf2 \
  --input data/11July2019/factorial*/output.txt \
  --physl data/factorial.physl \
  --label "data\/(11July2019\/factorial[^/]*).*"
```

## Serving
To run the interface, type `serve.py`.

# Collecting data via JetLag
JetLag can run jobs on remote clusters and pipe the results back to a running
`serve.py` instance. This setup assumes that you have a TACC login.

```bash
# with serve.py running in a different terminal...
git clone https://github.com/STEllAR-GROUP/JetLag
cd JetLag
python3 -m venv env
source env/bin/activate
pip3 install requests termcolor
```

If you are using your TACC login, you'll need to edit `remote_test.py` to use
`backend_tapis` instead of `backend_agave`.

```bash
python3 remote_test.py
```

The first time you run this, it will ask you for your TACC login and store the
username and password under `~/.TAPIS_USER` and `~/.TAPIS_PASSWORD`.

Note that if you forget to start `serve.py`, the results of the job will still
be stored in a `jobdata-###...` directory, that you can use as input to
`bundle.py`.

## JetLag via Jupyter
From the JetLag directory:

```bash
cd docker
docker-compose up   # on Windows, even in WSL, it's actually docker-compose.exe up
```

Open Demo.ipynb inside Jupyter, and it should be relatively self-guided.
Note that the docker-compose route `git clone`s the traveler repo, so this is
probably a good way to get data easily, but not the best for adding new features
/ debugging traveler itself.

# Development notes
Anything inside the `static` directory will be served; see its
[README](https://github.com/alex-r-bigelow/traveler-integrated/master/static/README.md)
for info on developing the web interface.

## About the poor man's database indexes
On the server side, one of the big priorities at the moment is that we're using
a [hacked version](https://github.com/alex-r-bigelow/intervaltree) of
[intervaltree](https://github.com/chaimleib/intervaltree) as a poor man's index
into the data (that allows for fast histogram computations). There are probably
a few opportunities for scalability:
- These are all built in memory and pickled to a file, meaning that this is the
  current bottleneck for loading large trace files. It would be really cool if
  we could make a version of this library that spools to disk when it gets too
  big, kind of like python's native `shelve` library.
- We really only need to build these things once, and do read-only queries—we
  should be able to build the indexes more efficiently if we know we'll never
  have to update them, and there's likely some functionality in the original
  library that we could get away with cutting

## Debugging traveler-integrated inside a running JetLag docker container

### Strategy 1: Point JetLag to your host IP address
***WSL setups will probably need to add something like `"bip": "192.168.200.1/24"` to Docker Desktop -> Settings -> Docker Engine for this to work***

You will need to open two terminal windows:

1. TERMINAL A: Run JetLag:

```bash
# Tell JetLag to send data to our host IP address
export TRAVELER_IP=`hostname -I | xargs`

# Here we build the latest version of JetLag locally...
git clone https://github.com/STEllAR-GROUP/JetLag.git
cd JetLag/docker
docker build . -t jetlag:test
docker run --rm -it -e TRAVELER_IP -p 8789:8789 --name jetlag_container jetlag:test
# Note that we DON'T expose the -p 8000:8000 port; otherwise this would conflict with your host traveler instance
```

2. TERMINAL B: Start our local version of traveler:

```bash
cd traveler-integrated
./serve.py
```

At this point, open up the jupyter notebook (url in TERMINAL A); `job.viz()`
commands will now pipe data to the version of `traveler-integrated` running in TERMINAL B.

To test that we can access the host instance of traveler from inside the docker container, in a third terminal:

```bash
docker exec -it jetlag_container bash

echo $TRAVELER_IP
# Should be the host's IP address

# Kill the traveler instance inside the container so we don't accidentally
# ping it
ps -A
kill PID # where PID corresponds to the python3 process

# Now ping traveler on the host
curl -I "$TRAVELER_IP:8000"
```

should look something like:

```
date: Wed, 03 Feb 2021 23:22:51 GMT
server: uvicorn
content-length: 31
content-type: application/json
```

### Strategy 2: mount your version of traveler-integrated as a volume
Be careful with this; changes that you make inside the docker container will also affect your host repo.

1. From `JetLag/docker`:

```bash
cp ../../traveler-integrated/docker-compose.jetlag.yml ./docker-compose.override.yml
docker-compose up
```

Now JetLag will replace its cloned version of the `main` branch of
`traveler-integrated` with your local repository before starting everything up.

I haven't tested this thoroughly. Likely hiccups:

- This seems to be enough to tweak client-side stuff in `static`, but
  you'll need to kill and restart the server inside the container if
  you make server-side changes.

- On non-Linux systems, you'll probably need to rebuild the
  [C dependencies](#building-c-dependencies) inside the docker
  container

## Related Papers

K. Williams, A. Bigelow, and K. Isaacs. [Visualizing a Moving Target: A Design Study on Task Parallel Programs in the Presence of Evolving Data and Concerns](https://arxiv.org/abs/1905.13135v4). IEEE Transactions on Visualization and Computer Graphics, Proceedings of InfoVis '19. 26(1):1118-1128, 2020.


S. R. Brandt, A. Bigelow, S. A. Sakin, K. Willliams, K. E. Isaacs, K. Huck, R. Tohid, B. Wagle, S. Shirzad, and H. Kaiser. [JetLag: An Interactive, Asynchronous Array Computing Environment](https://dl.acm.org/doi/abs/10.1145/3311790.3396657). In PEARC '20: Practice and Experience in Advanced Research Computing. July 2020.

S. R. Brandt, B. Hasheminezhad, N. Wu, S. A. Sakin, A. R. Bigelow, K. E. Isaacs, K. Huck, H. Kaiser. Distributed Asynchronous Array Computing with the Jetlag Environment. Proceedings of the 9th Workshop on Python for High-Perforrmance and Scientific Computing (PyHPC). November 2020.

## Acknowledgements

This work has been supported by the United States Department of Defense through DTIC Contract FA8075-14-D-0002-0007, the National Science Foundation under NSF [III-1656958](https://www.nsf.gov/awardsearch/showAward?AWD_ID=1656958), and the Department of Energy under DE-SC0022044.
