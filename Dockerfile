FROM stevenrbrandt/phylanx.test:working

USER root
RUN echo jovyan:fishfood77 | chpasswd

# Set up traveler-integrated
WORKDIR /
COPY . /traveler-integrated
WORKDIR /traveler-integrated
RUN find . | xargs chown jovyan
RUN pip3 install -r requirements.txt
EXPOSE 8000

# Set up jupyter
RUN pip3 install jupyter requests
EXPOSE 8789

USER jovyan

# Default container command is to launch both traveler-integrated and jupyter
CMD ["bash", "/traveler-integrated/docker.sh"]
