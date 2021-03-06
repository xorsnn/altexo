#include "mainwindow.h"
#include "ui_mainwindow.h"
#include <QPluginLoader>
#include <QDir>
#include <QJsonDocument>
#include "interfaces/AlStreamerInterface.h"

MainWindow::MainWindow(QWidget *parent) :
    QMainWindow(parent),
    ui(new Ui::MainWindow)
{

    this->one2one = true;
    ui->setupUi(this);

    QSettings settings;
    QString room = settings.value("altexo/alRoom", "altexo-chat").toString();
    this->ui->roomEdit->setText(room);

//    connect(this, SIGNAL(addMaxDepthSignal(int)), ui->alGLWidget->getALKinectInterface(), SLOT(changeMaxDepth(int)));
//    connect(this, SIGNAL(substractMaxDepthSignal(int)), ui->alGLWidget->getALKinectInterface(), SLOT(changeMaxDepth(int)));

    this->videoSurface = new ALVideoSurface(this);
    QGridLayout *videoLayout = new QGridLayout();
    videoLayout->addWidget(videoSurface);
    this->ui->videoFrame->setLayout(videoLayout);

    this->timer = new QTimer(this);
    connect(timer, SIGNAL(timeout()), this, SLOT(requestNewFrameSlot()));
    timer->start(40);
}

MainWindow::~MainWindow()
{
    delete ui;
}

void MainWindow::requestNewFrameSlot() {
    Q_EMIT this->requestNewFrameSignal();
}

ALVideoSurface* MainWindow::getVideoSurfaceRef() {
    return this->videoSurface;
}

void MainWindow::on_startRecorder_clicked()
{
    if (this->ui->startRecorder->text() == "Record") {
        qDebug() << this->ui->startRecorder->text();
        this->timer->stop();
        Q_EMIT this->startRecorderSignal();

        this->ui->startRecorder->setText("Stop");
        this->ui->startRecorder->setStyleSheet("QPushButton {color: red;}");
    } else {
        timer->start(40);
        Q_EMIT this->stopRecorderSignal();
        this->ui->startRecorder->setText("Record");
        this->ui->startRecorder->setStyleSheet("QPushButton {color: black;}");
    }
}

void MainWindow::on_actionSettings_triggered()
{
    SettingsDialog sDialog;
    this->connect(&sDialog, SIGNAL(settingsChangedSignal()), this, SLOT(settingsChangedSlot()));
    sDialog.setModal(true);
    int ret = sDialog.exec();
    qDebug() << ret;
    switch (ret) {
        case QDialog::Accepted:
        {
            break;
        }
        case QDialog::Rejected:
        {
            break;
        }
        default:
            // should never be reached
            break;
    }
}

void MainWindow::settingsChangedSlot()
{
    Q_EMIT this->settingsChangedSignal();
}

void MainWindow::on_streamButton_clicked()
{
    qDebug() << "stream";
    Q_EMIT this->signalStartButton_clicked();
}

void MainWindow::on_StartButton_clicked()
{
    Q_EMIT this->signalStartButton_clicked();
}

void MainWindow::on_pProcessAnswerButton_clicked()
{
    Q_EMIT this->signalProcessAnswerButton_clicked(this->ui->pAnswerText->toPlainText());

}

void MainWindow::on_pProcessRemoteICEButton_clicked()
{
    Q_EMIT this->signalProcessRemoteICEButton_clicked(this->ui->pRemoteICEText->toPlainText());
//    QTimer::singleShot(2000, this, SLOT(readyToStreamSlot()));
}

void MainWindow::slotSDPText(const QString &sdp) {
    qDebug() << "AlMainWindow::slotSDPText";
    this->ui->pOfferText->setPlainText(sdp);
}

void MainWindow::slotOnLocalIceCandidate(const QString &iceCandidate)
{
    QString str = this->ui->pOwnICEText->toPlainText();
    str += iceCandidate + "\n";
    this->ui->pOwnICEText->setPlainText(str);
    if (!this->one2one) {
        QJsonDocument docR = QJsonDocument::fromJson(iceCandidate.toUtf8());
        QJsonObject obj;
        obj["id"] = "onIceCandidate";
        obj["candidate"] = docR.object();
        QJsonDocument doc(obj);
        Q_EMIT this->sendTextMessageSignal(doc.toJson());
    }
}

void MainWindow::onJsonMsgSlot(QString msg) {
    QJsonDocument doc = QJsonDocument::fromJson(msg.toUtf8());
    QJsonObject jsonObj = doc.object();
    if (jsonObj["type"].toString() == "SDP") {
        this->ui->pAnswerText->setPlainText(jsonObj["body"].toString());
        QTimer::singleShot(1000, this, SLOT(sendIceCandidatesSlot()));
    } else if (jsonObj["type"].toString() == "ICE") {
        this->ui->pRemoteICEText->setPlainText(jsonObj["body"].toString());
        Q_EMIT this->readyToStreamSignal();
    } else if (jsonObj["id"].toString() == "iceCandidate") {
        QJsonDocument doc(jsonObj["candidate"].toObject());
        QString str = this->ui->pRemoteICEText->toPlainText();
        str += doc.toJson();
        this->ui->pRemoteICEText->setPlainText(str);
    } else if (jsonObj["id"].toString() == "presenterResponse") {
        this->ui->pAnswerText->setPlainText(jsonObj["sdpAnswer"].toString());
        Q_EMIT this->readyToStreamSignal();
//        QTimer::singleShot(2000, this, SLOT(readyToStreamSlot()));
    } else {
      // TODO, notify the case
    }
}

void MainWindow::sendIceCandidatesSlot() {
    qDebug() << "MainWindow::sendIceCandidatesSlot";
    Q_EMIT this->sendIceCandidatesSignal(this->ui->pOwnICEText->toPlainText());
}

void MainWindow::on_roomEdit_textChanged(const QString &arg1)
{
    QSettings settings;
    settings.setValue("altexo/alRoom", arg1);
}

void MainWindow::readyToStreamSlot() {
    Q_EMIT this->readyToStreamSignal();
}
