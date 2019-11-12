FROM stevenrbrandt/phylanx.test:working

USER root
RUN echo jovyan:fishfood77 | chpasswd
WORKDIR /
RUN git clone https://github.com/alex-r-bigelow/traveler-integrated.git
WORKDIR /traveler-integrated
RUN pip3 install -r requirements.txt
CMD ["python3", "./serve.py"]
