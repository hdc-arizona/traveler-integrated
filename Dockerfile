FROM stevenrbrandt/phylanx.test:working

USER root
RUN echo jovyan:fishfood77 | chpasswd

# Build phylanx
RUN build.sh
ENV PYTHONPATH=/root/phylanx/build/python/build/lib.linux-x86_64-3.6

# Set up traveler-integrated
WORKDIR /
RUN git clone https://github.com/alex-r-bigelow/traveler-integrated
WORKDIR /traveler-integrated
RUN pip3 install -r requirements.txt
EXPOSE 8000

# Set up jupyter
RUN pip3 install jupyter requests
EXPOSE 8789

# Default container command is to launch both traveler-integrated and jupyter
CMD ["bash", "docker.sh"]
