//! Reads the Mac's own Contacts (the Contacts app / iCloud) so CENTRA can import them.
//! macOS asks once for permission. Notes are not read: Apple only allows that with a special entitlement.

use std::cell::RefCell;
use std::ptr::NonNull;
use std::rc::Rc;
use std::sync::mpsc;
use std::time::Duration;

use base64::Engine;
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::AnyThread;
use objc2_contacts::{
    CNAuthorizationStatus, CNContact, CNContactBirthdayKey, CNContactEmailAddressesKey, CNContactFamilyNameKey, CNContactFetchRequest,
    CNContactGivenNameKey, CNContactJobTitleKey, CNContactMiddleNameKey, CNContactNicknameKey, CNContactOrganizationNameKey,
    CNContactPhoneNumbersKey, CNContactPostalAddressesKey, CNContactSocialProfilesKey, CNContactStore, CNContactThumbnailImageDataKey,
    CNContactUrlAddressesKey, CNEntityType, CNKeyDescriptor, CNLabeledValue,
};
use objc2_foundation::{NSArray, NSError, NSString};
use serde::Serialize;

#[derive(Serialize, Default)]
pub struct Labeled {
    label: String,
    value: String,
}

#[derive(Serialize, Default)]
pub struct MacContact {
    id: String,
    given: String,
    middle: String,
    family: String,
    nickname: String,
    company: String,
    title: String,
    phones: Vec<Labeled>,
    emails: Vec<Labeled>,
    addresses: Vec<Labeled>,
    urls: Vec<Labeled>,
    socials: Vec<Labeled>,
    /// YYYY-MM-DD, or --MM-DD when the year is not known.
    birthday: Option<String>,
    /// data:image/jpeg;base64,… (the small version Contacts keeps)
    photo: Option<String>,
}

fn s(x: Retained<NSString>) -> String {
    x.to_string().trim().to_string()
}

fn label<T: objc2::Message + objc2_foundation::NSCopying + objc2_foundation::NSSecureCoding>(lv: &CNLabeledValue<T>) -> String {
    unsafe { lv.label() }.map(|l| unsafe { CNLabeledValue::<NSString>::localizedStringForLabel(&l) }.to_string()).unwrap_or_default()
}

fn access(store: &CNContactStore) -> Result<(), String> {
    let status = unsafe { CNContactStore::authorizationStatusForEntityType(CNEntityType::Contacts) };
    if status == CNAuthorizationStatus::Authorized || status == CNAuthorizationStatus::Limited {
        return Ok(());
    }
    if status != CNAuthorizationStatus::NotDetermined {
        return Err("denied".into());
    }
    let (tx, rx) = mpsc::channel::<bool>();
    let reply = RcBlock::new(move |ok: Bool, _err: *mut NSError| {
        let _ = tx.send(ok.as_bool());
    });
    unsafe { store.requestAccessForEntityType_completionHandler(CNEntityType::Contacts, &reply) };
    match rx.recv_timeout(Duration::from_secs(120)) {
        Ok(true) => Ok(()),
        _ => Err("denied".into()),
    }
}

pub fn fetch() -> Result<Vec<MacContact>, String> {
    let store = unsafe { CNContactStore::new() };
    access(&store)?;
    let keys: Vec<&ProtocolObject<dyn CNKeyDescriptor>> = unsafe {
        [
            CNContactGivenNameKey, CNContactMiddleNameKey, CNContactFamilyNameKey, CNContactNicknameKey, CNContactOrganizationNameKey,
            CNContactJobTitleKey, CNContactPhoneNumbersKey, CNContactEmailAddressesKey, CNContactPostalAddressesKey, CNContactUrlAddressesKey,
            CNContactSocialProfilesKey, CNContactBirthdayKey, CNContactThumbnailImageDataKey,
        ]
        .into_iter()
        .map(ProtocolObject::from_ref)
        .collect()
    };
    let keys = NSArray::from_slice(&keys);
    let request = unsafe { CNContactFetchRequest::initWithKeysToFetch(CNContactFetchRequest::alloc(), &keys) };

    let found: Rc<RefCell<Vec<Retained<CNContact>>>> = Rc::new(RefCell::new(Vec::new()));
    let sink = found.clone();
    let each = RcBlock::new(move |c: NonNull<CNContact>, _stop: NonNull<Bool>| {
        if let Some(c) = unsafe { Retained::retain(c.as_ptr()) } {
            sink.borrow_mut().push(c);
        }
    });
    let mut err: Option<Retained<NSError>> = None;
    let ok = unsafe { store.enumerateContactsWithFetchRequest_error_usingBlock(&request, Some(&mut err), &each) };
    if !ok {
        return Err(err.map(|e| e.localizedDescription().to_string()).unwrap_or_else(|| "error".into()));
    }

    let out = found
        .borrow()
        .iter()
        .map(|c| unsafe {
            let mut m = MacContact {
                id: s(c.identifier()),
                given: s(c.givenName()),
                middle: s(c.middleName()),
                family: s(c.familyName()),
                nickname: s(c.nickname()),
                company: s(c.organizationName()),
                title: s(c.jobTitle()),
                ..Default::default()
            };
            for lv in c.phoneNumbers().iter() {
                m.phones.push(Labeled { label: label(&lv), value: s(lv.value().stringValue()) });
            }
            for lv in c.emailAddresses().iter() {
                m.emails.push(Labeled { label: label(&lv), value: s(lv.value()) });
            }
            for lv in c.postalAddresses().iter() {
                let a = lv.value();
                let parts = [s(a.street()), [s(a.postalCode()), s(a.city())].join(" ").trim().to_string(), s(a.country())];
                let value = parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join(", ");
                m.addresses.push(Labeled { label: label(&lv), value });
            }
            for lv in c.urlAddresses().iter() {
                m.urls.push(Labeled { label: label(&lv), value: s(lv.value()) });
            }
            for lv in c.socialProfiles().iter() {
                let p = lv.value();
                let user = s(p.username());
                m.socials.push(Labeled { label: s(p.service()), value: if user.is_empty() { s(p.urlString()) } else { user } });
            }
            if let Some(b) = c.birthday() {
                let (y, mo, d) = (b.year(), b.month(), b.day());
                if (1..=12).contains(&mo) && (1..=31).contains(&d) {
                    m.birthday = Some(if (1..=9999).contains(&y) && y != 1604 { format!("{y:04}-{mo:02}-{d:02}") } else { format!("--{mo:02}-{d:02}") });
                }
            }
            if let Some(data) = c.thumbnailImageData() {
                m.photo = Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(data.to_vec())));
            }
            m
        })
        .collect();
    Ok(out)
}
