const fetch=require('node-fetch');
const admin = require('firebase-admin');
const addToWallet = require('../../common').addToWallet;
const UpdateBooking = require('../../common/sharedFunctions').UpdateBooking;
const request = require('request');

module.exports.render_checkout = async function (request, response) {
    const config = (await admin.database().ref('payment_settings/xendit').once('value')).val();
    const secret_key = config.secret_key;
    const authToken = Buffer.from(secret_key + ':').toString('base64');
    const allowed = ["IDR"];
    const API_URL = "https://api.xendit.co/v2/invoices"; 
    const refr = request.get('Referrer');
    const server_url = refr ? ((refr.includes('bookings') || refr.includes('addbookings') || refr.includes('userwallet'))? refr.substring(0, refr.length - refr.split("/")[refr.split("/").length - 1].length) : refr) : request.protocol + "://" + request.get('host') + "/";

    const order_id = request.body.order_id;
    const data = {
        "external_id": order_id,
        "description": "Invoice " + "#" + order_id,
        "amount": (parseFloat(request.body.amount)* 1000).toFixed(2),
        "currency": allowed.includes(request.body.currency) ? request.body.currency : 'IDR',
        "customer": {
            "given_names": request.body.first_name,
            "surname": request.body.last_name,
            "email": request.body.email,
            "mobile_number": request.body.mobile_no
        },
        "customer_notification_preference": {
            "invoice_paid": ["email", "whatsapp"]
        },
        "success_redirect_url": server_url + "xendit-process?order_id=" + request.body.order_id,
    }
    fetch(API_URL, {
        method: 'POST',
        headers: {
            Authorization:  'Basic ' + authToken,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    })
        .then(res => res.json())
        .then(json => {
            if (json && json.invoice_url) {
                admin.database().ref('/xendit/' +  request.body.order_id).set({
                    amount: request.body.amount,
                    id: json.id
                })
                response.redirect(json.invoice_url);
            } else {
                response.redirect('/cancel');
            }
             return true;
        })
        .catch(error=>{
            console.log(error);
            response.redirect('/cancel');
        });
};

module.exports.process_checkout = async function (req, res) {
    const config = (await admin.database().ref('payment_settings/xendit').once('value')).val();
    const secret_key = config.secret_key;
    const authToken = Buffer.from(secret_key + ':').toString('base64');
    const order_id = req.query.order_id;
    if(order_id.length> 0){
        admin.database().ref('xendit').child(order_id).once('value', xenditsnap => {
            const checkout_id = xenditsnap.val();
            const id = checkout_id.id;
            const options = {
                'method': 'GET',
                'url': `https://api.xendit.co/v2/invoices/${id}`,
                'headers': {
                    Authorization:  'Basic ' + authToken,
                },
            };
            request(options, (error, response) => {
                if(error){
                    res.redirect('/cancel');
                }
                    const json = JSON.parse(response.body);
                    const transaction_id = json.id
                    const amount = (parseFloat(json.amount) / 1000).toFixed(2);
                    if(json && json.status === 'PAID'){
                        admin.database().ref('bookings').child(order_id).once('value', snapshot => {
                            if(snapshot.val()){
                                const bookingData = snapshot.val();
                                UpdateBooking(bookingData,order_id,transaction_id,'xendit');
                                res.redirect(`/success?order_id=${order_id}&amount=${amount}&transaction_id=${transaction_id}`);
                                admin.database().ref('xendit').child(order_id).remove();
                            }else{
                                if(order_id.startsWith("wallet")){
                                    addToWallet(order_id.substr(7,order_id.length - 12), amount, order_id, transaction_id);
                                    res.redirect(`/success?order_id=${order_id}&amount=${amount}&transaction_id=${transaction_id}`);
                                    admin.database().ref('xendit').child(order_id).remove();
                                }else{
                                    res.redirect('/cancel');
                                }
                            }
                        });
                    }else{
                        res.redirect('/cancel');
                    }
            });
        });
    } else{
        res.redirect('/cancel');
    }
};
    
    