const fetch = require("node-fetch");
const admin = require("firebase-admin");
const addToWallet = require("../../common").addToWallet;
const UpdateBooking = require("../../common/sharedFunctions").UpdateBooking;
const request = require("request");

module.exports.render_checkout = async function (request, response) {
  const config = (
    await admin.database().ref("payment_settings/tap").once("value")
  ).val();

  const API_URL = "https://api.tap.company/v2/charges";
  const secret_key = config.secret_key;
  const merchantId = config.merchantId;
  const allowed = ["KWD"];
  const order_id = request.body.order_id;
  const refr = request.get("Referrer");
  const server_url = refr
    ? refr.includes("bookings") ||
      refr.includes("addbookings") ||
      refr.includes("userwallet")
      ? refr.substring(
          0,
          refr.length - refr.split("/")[refr.split("/").length - 1].length
        )
      : refr
    : request.protocol + "://" + request.get("host") + "/";

  const body = {
      "amount": request.body.amount,
      "currency":allowed.includes(request.body.currency) ? request.body.currency : 'KWD',
      "customer_initiated": true,
      "threeDSecure": true,
      "save_card": false,
      "reference": {
        "transaction": "txn_01",
        "order": order_id
      },
      "receipt": {
        "email": true,
        "sms": true,
      },
      "customer": {
        "first_name": request.body.first_name,
        "last_name": request.body.last_name,
        "email": request.body.email,
      },
      "merchant": {
        "id": merchantId,
      },
      "source": {
        "id": "src_all",
      },
      "redirect": {
        "url": server_url + 'tap-process?order_id=' + order_id,
      },
  };
  fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization:
      "Bearer " + secret_key,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
    .then((res) => res.json())
    .then((json) => {
      if ( json && json.id ) {
        admin
          .database().ref("/tap/" + order_id).set({
            amount: request.body.amount,
            tapId: json.id
          })
        response.redirect(json.transaction.url);
      } else {
        response.redirect("/cancel");
      }
      return true;
    })
    .catch((error) => {
      console.log(error);
      response.redirect("/cancel");
    });
};

module.exports.process_checkout = async function (req, res) {
  const config = (
    await admin.database().ref("payment_settings/tap").once("value")
  ).val();
  const secret_key = config.secret_key;
  const order_id = req.query.order_id;
  const transaction_id = req.query.tap_id;
  if (order_id.length > 0) {
    admin
      .database()
      .ref("tap")
      .child(order_id)
      .once("value", (tapsnap) => {
        const checkoutdata = tapsnap.val();
        const amount = checkoutdata.amount;
        if (
          checkoutdata &&
          checkoutdata.tapId === transaction_id
        ) {
          const options = {
            method: "GET",
            url: `https://api.tap.company/v2/charges/${transaction_id}`,
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              Authorization: "Bearer " + secret_key,
            },
          };
          request(options, (error, response) => {
            if (error) {
              res.redirect("/cancel");
            }
            if (response.body.length > 1 ) {
              const json = JSON.parse(response.body);
              if (json && json.id) {
                const transaction_id = json.id;
                admin
                  .database()
                  .ref("bookings")
                  .child(order_id)
                  .once("value", (snapshot) => {
                    if (snapshot.val()) {
                      const bookingData = snapshot.val();
                      UpdateBooking(
                        bookingData,
                        order_id,
                        transaction_id,
                        "tap"
                      );
                      res.redirect(
                        `/success?order_id=${order_id}&amount=${amount}&transaction_id=${transaction_id}`
                      );
                      admin.database().ref("tap").child(order_id).remove();
                    } else {
                      if (order_id.startsWith("wallet")) {
                        addToWallet(
                          order_id.substr(7, order_id.length - 12),
                          amount,
                          order_id,
                          transaction_id
                        );
                        res.redirect(
                          `/success?order_id=${order_id}&amount=${amount}&transaction_id=${transaction_id}`
                        );
                        admin.database().ref("tap").child(order_id).remove();
                      } else {
                        res.redirect("/cancel");
                      }
                    }
                  });
              } else {
                res.redirect("/cancel");
              }
            } else {
              res.redirect("/cancel");
            }
          });
        } else {
          res.redirect("/cancel");
        }
      });
  } else {
    res.redirect("/cancel");
  }
};