const mongoose = require('mongoose');
const moment = require('moment');
const UserModel = mongoose.model('User');
const AccessTokenModel = mongoose.model('AccessToken');
const sendEmail = require('../mail/sendEmail');
const httpStatus = require('../helpers/httpStatus');
const accessTokenTypes = require('../helpers/accessTokenTypes');
const logs = require('../helpers/logs');
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'devmode';

class Auth {
  async login(req, res) {
    if (!req.body) {
      return res.status(httpStatus.NO_CONTENT).send();
    }
    try {
      let user = await UserModel.findByCredentials(
        req.body.email,
        req.body.password
      );
      if (user && user._id && user.emailVerified === true) {
        let token = jwt.sign(
          {
            _id: user._id,
            expires: moment()
              .add(60, 'days')
              .valueOf()
          },
          secret
        );

        try {
          AccessTokenModel.create(
            {
              userId: user._id,
              token: token,
              type: accessTokenTypes.AUTH,
              location: 'Update this',
              ip: req.connection.remoteAddress || req.headers['x-forwarded-for']
            },
            (err, created) => {
              if (err) {
                logs(
                  `Error on user login [${user.email}]. Error: ..:: ${err.message} ::..`,
                  'error'
                );
                return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
                  status: httpStatus.INTERNAL_SERVER_ERROR,
                  error: err.message
                });
              }
              logs(`Logged user [${user.email}]`);
              res.status(httpStatus.OK).json({ token });
            }
          );
        } catch (e) {
          logs(
            `Error on user login [${user.email}]. Error: ..:: ${e.message} ::..`,
            'error'
          );
          res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
            status: httpStatus.INTERNAL_SERVER_ERROR,
            error: e.message
          });
        }
      } else {
        logs(`Error on login [ Email not verified ${user.email} ]`);
        res.status(httpStatus.UNAUTHORIZED).json({
          message: 'Email not verified.',
          status: httpStatus.UNAUTHORIZED
        });
      }
    } catch (e) {
      logs(`Error on login [${e.message}]`);
      res.status(httpStatus.UNAUTHORIZED).json({
        message: e.message,
        status: httpStatus.UNAUTHORIZED
      });
    }
  }

  async verifyEmail(req, res) {
    if (!req.body) {
      return res.status(httpStatus.NO_CONTENT).send();
    }
    const token = req.body.token;

    try {
      let user = await UserModel.findByToken(token);

      const AccessTokenUser = await AccessTokenModel.findOne({
        userId: user._id,
        token: token,
        type: accessTokenTypes.VERIFY_EMAIL,
        status: true
      });

      if (user && AccessTokenUser) {
        if (user.emailVerified) {
          return res.status(httpStatus.OK).json({
            status: httpStatus.OK,
            message: 'Your account already verified'
          });
        }

        try {
          await UserModel.updateOne(
            { _id: user._id },
            {
              emailVerified: true
            }
          );

          await AccessTokenModel.updateOne(
            {
              userId: user._id,
              token: token,
              status: true,
              type: accessTokenTypes.VERIFY_EMAIL
            },
            {
              status: false,
              token: 'null'
            }
          );

          return res.status(httpStatus.OK).json({
            status: httpStatus.OK,
            message: 'Your account verified'
          });
        } catch (e) {
          return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
            status: httpStatus.INTERNAL_SERVER_ERROR,
            message: 'INTERNAL_SERVER_ERROR'
          });
        }
      } else {
        return res.status(httpStatus.UNAUTHORIZED).json({
          status: httpStatus.UNAUTHORIZED,
          message: 'Not authorized'
        });
      }
    } catch (e) {
      logs(`Error [${e}]`);
      return res.status(httpStatus.UNAUTHORIZED).json({
        status: httpStatus.UNAUTHORIZED,
        message: 'Not authorized'
      });
    }
  }

  async forgetPassword(req, res) {
    if (!req.body) {
      return res.status(httpStatus.NO_CONTENT).send();
    }
    const { email } = { ...req.body };

    try {
      const user = await UserModel.findOne({ email });

      if (!user) {
        logs(
          `Error user with [${email}]. Error: ..:: User not found with this email. ::..`,
          'error'
        );
        return res.status(httpStatus.NON_AUTHORITATIVE_INFORMATION).json({
          status: httpStatus.NON_AUTHORITATIVE_INFORMATION,
          error: 'User not found with this email.'
        });
      }

      let token = jwt.sign(
        {
          _id: user._id,
          expires: moment()
            .add(30, 'days')
            .valueOf()
        },
        secret
      );

      await AccessTokenModel.create({
        userId: user._id,
        token: token,
        type: accessTokenTypes.RESET,
        location: 'Update this',
        ip: req.connection.remoteAddress || req.headers['x-forwarded-for']
      });

      await sendEmail({
        to: user.email,
        subject: 'Reset link to your password.',
        template: `<h1>${token}</h1>`
      });

      return res.status(httpStatus.CREATED).json({
        status: httpStatus.CREATED,
        message: 'Reset link send'
      });
    } catch (e) {
      logs(
        `Error on find user [${email}]. Error: ..:: ${e.message} ::..`,
        'error'
      );
      res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        status: httpStatus.INTERNAL_SERVER_ERROR,
        error: 'Please try again later.'
      });
    }
  }

  async logout(req, res) {
    if (!req.body) {
      return res.status(httpStatus.NO_CONTENT).send();
    }

    if (!req.headers.authorization) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        status: httpStatus.UNAUTHORIZED,
        message: 'Not authorized'
      });
    }
    let token = req.headers.authorization;

    try {
      let user = await UserModel.findByToken(token);

      if (user) {
        const AccessTokenUser = await AccessTokenModel.updateOne(
          {
            userId: user._id,
            token: token,
            status: true
          },
          {
            status: false,
            token: 'null'
          }
        );

        if (AccessTokenUser.nModified) {
          return res.status(httpStatus.OK).json({
            status: httpStatus.OK,
            message: 'Logged out successfully'
          });
        } else {
          return res.status(httpStatus.OK).json({
            status: httpStatus.OK,
            message: 'Your session is already logged out'
          });
        }
      } else {
        return res.status(httpStatus.UNAUTHORIZED).json({
          status: httpStatus.UNAUTHORIZED,
          message: 'Not authorized'
        });
      }
    } catch (e) {
      logs(`Error [${e}]`);
      return res.status(httpStatus.UNAUTHORIZED).json({
        status: httpStatus.UNAUTHORIZED,
        message: 'Not authorized'
      });
    }
  }
}

module.exports = new Auth();
