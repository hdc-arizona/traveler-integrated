FROM stevenrbrandt/phylanx.test:working

USER root
RUN echo jovyan:fishfood77 | chpasswd
WORKDIR /
RUN git clone https://github.com/alex-r-bigelow/traveler-integrated.git
WORKDIR /traveler-integrated
RUN build.sh
RUN pip3 install -r requirements.txt
EXPOSE 8000

RUN pip3 install jupyter
EXPOSE 8789

COPY start.sh start.sh
CMD ["bash", "./start.sh"]
