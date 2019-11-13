FROM stevenrbrandt/phylanx.test:working

USER root
RUN echo jovyan:fishfood77 | chpasswd

# RUN build.sh
ENV PYTHONPATH=/root/phylanx/build/python/build/lib.linux-x86_64-3.6

WORKDIR /
RUN git clone https://github.com/alex-r-bigelow/traveler-integrated
# COPY . /traveler-integrated
WORKDIR /traveler-integrated
RUN pip3 install -r requirements.txt
EXPOSE 8000

RUN pip3 install jupyter
EXPOSE 8789

CMD ["bash", "docker.sh"]
