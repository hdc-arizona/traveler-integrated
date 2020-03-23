traveler-integrated
===================

An integrated visualization system for parallel execution data, including OTF2 traces annd HPX execution trees

- [Basic setup](#basic-setup)
- [Development setup](#development-setup)
  - [Building](#building)
  - [Starting the container](#starting-the-container)
  - [Moving data in and out of the docker container](#moving-data-in-and-out-of-the-docker-container)
  - [Bundling data](#bundling-data)
  - [Bundling examples](#bundling-examples)
- [Standalone setup without jupyter or docker](#standalone-setup-without-jupyter-or-docker)
- [Development notes](#development-notes)

# Basic setup
If you just want to collect data from jupyter cells and visualize it directly,
this is the most straightforward approach:

After installing Docker Compose:
```bash
git clone https://github.com/alex-r-bigelow/traveler-integrated
cd traveler-integrated
docker-compose up
```

You will see something like this:
```
traveler_1  | To access the notebook, open this file in a browser copy and paste this URL:
traveler_1  |
traveler_1  |  http://localhost:8789/?token=Dii7P5KVBJx9VrAjnXh1r5IIgRA4SmKe
```

Copy that link into your browser, and navigate to `notebook/demo.ipynb`

# Development setup
If you want to load performance data from the command line, or you want to work
on traveler-integrated code, this is the setup that you'll want to use:

## Building
After installing Docker (Docker Compose isn't necessary):
```bash
git clone https://github.com/alex-r-bigelow/traveler-integrated
cd traveler-integrated
docker build . -t your-dockerhub-username/traveler-integrated
```
If you make any changes to `Dockerfile`, or if you add python or other
dependencies, or if there are upstream updates to HPX / Phylanx that you want to
incorporate, you'll need to repeat this step.


## Starting the container
```bash
docker run \
  -it \
  -p 8000:8000 \
  -p 8789:8789 \
  -w /traveler/dev \
  --mount type=bind,source="$(pwd)",target=/traveler-dev \
  your-dockerhub-username/traveler-integrated \
  /bin/bash
```

A couple notes with this approach:
- This command "mounts" your host `traveler-integrated` directory in the
  container's root `/` directory as `/traveler-dev`. *Don't* use
  `/traveler-integrated` inside the docker container, as it won't contain any
  changes that you make
- This will just give you a `bash` terminal inside the container, where you can
  load data from the command line using `bundle.py` (see
  [below](#bundling-data)); it won't actually start Jupyter or
  traveler-integrated. For that, run `bash /traveler-dev/develop.sh`.
- `/traveler-dev/develop.sh` launches Jupyter and traveler-integrated together.
  Jupyter doesn't like to exit without confirmation, but the prompt may be
  buried in the log when you hit `Ctrl-C`; to actually get it to terminate, you
  need to hit `Ctrl-C` twice. Remember that you will still be inside the docker
  container after terminating; you will still need to type `exit` to return to a
  normal terminal outside of the container.
- In the event that something really refuses to exit, in another terminal, run
  `docker container ls` to see which container is still running, and then
  `docker stop container_name` in another terminal to shut it down.
- Other docker commands that you might need: `docker ps -a` lists all
  containers, including ones that you've stopped; to clean these, run
  `docker container prune`.
- If you're using WSL, it's not very smart about paths; you need to use an
  absolute path in place of `"$(pwd)"` that actually references drive letters,
  like `/mnt/d/Repositories/traveler-integrated`

Alternatively, with this setup, you can auto-launch Jupyter and
traveler-integrated with this command:

```bash
docker run -p 8000:8000 -p 8789:8789 your-dockerhub-username/traveler-integrated
```

## Moving data in and out of the docker container
One of the main reasons to use this setup is to be able to load data from the
command line. Outside of the docker container (whether or not it's running),
you can do things like:
```bash
mv als-30Jan2019 traveler-integrated/data/als-30Jan2019
```
and the datasets should be visible inside the container under
`/traveler-dev/data`.

## Bundling data
At this point, you will need to run `bundle.py` to get data loaded into the
traveler-integrated interface (note: do ***not*** run this while
traveler-integrated is running!). For basic information on how to do this, see
`bundle.py --help`.

If something goes wrong, `bundle.py` ***should*** behave reasonably
idempotently, but if you just want to start with a fresh slate anyway, try
`rm -rf /traveler-dev/db`.

## Bundling examples
Note that each of these examples assume that you're running inside a docker
image; in that case, the `--db_dir /traveler-dev/db` flag is important to
preserve bundled data across docker runs. Otherwise, the data will be bundled
into `/tmp/travler-integrated`, and will be unavailable when you start a new
container.

A simple example bundling the full phylanx output and an OTF2 trace:
```bash
./bundle.py \
  --db_dir /traveler-dev/db \
  --input data/als-30Jan2019/test_run/output.txt \
  --otf2 data/als-30Jan2019/test_run/OTF2_archive/APEX.otf2 \
  --label "2019-01-30 ALS Test Run"
```

Bunding just an OTF2 trace, as well as a source code file:
```bash
./bundle.py \
  --db_dir /traveler-dev/db \
  --otf2 data/fibonacci-04Apr2018/OTF2_archive/APEX.otf2 \
  --python data/fibonacci-04Apr2018/fibonacci.py \
  --label "2019-04-04 Fibonacci"
```

Loading many files at once (using a regular expression to match globbed paths):
```bash
./bundle.py \
  --db_dir /traveler-dev/db \
  --tree data/als_regression/*.txt \
  --performance data/als_regression/*.csv \
  --physl data/als_regression/als.physl \
  --cpp data/als_regression/als_csv_instrumented.cpp \
  --label "data/als_regression/(\d*-\d*-\d*).*"
```

Bringing it all together:
```bash
./bundle.py \
  --db_dir /traveler-dev/db \
  --otf2 data/11July2019/factorial*/OTF2_archive/APEX.otf2 \
  --input data/11July2019/factorial*/output.txt \
  --physl data/factorial.physl \
  --label "data\/(11July2019\/factorial[^/]*).*"
```

# Standalone setup without jupyter or docker
This is the setup for traveler-integrated on its own, without the pre-built
phylanx installation for generating data, nor the jupyter notebook setup.

## OTF2
If you plan to bundle otf2 traces,
[otf2](https://www.vi-hps.org/projects/score-p/) needs to be installed and its
binaries need to be in your `PATH`

## Python dependencies
```bash
python3 -m venv env
source env/bin/activate
pip3 install -r requirements.txt
```

## Running
See [above](#bundling-data) for how to bundle data from the command line; in
this context, you can probably omit the `--db_dir` arguments.

To run the interface, type `serve.py`.

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
